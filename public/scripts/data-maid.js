import { getRequestHeaders } from '../script.js';
import { VIDEO_EXTENSIONS } from './constants.js';
import { t } from './i18n.js';
import { callGenericPopup, Popup, POPUP_TYPE } from './popup.js';
import { renderTemplateAsync } from './templates.js';
import { appendErrorCode, humanFileSize, timestampToMoment } from './utils.js';

/**
 * @typedef {object} DataMaidReportResult
 * @property {import('../../src/endpoints/data-maid.js').DataMaidSanitizedReport} report - The sanitized report of the Data Maid.
 * @property {string} token - The token to use for the Data Maid report.
 */

/**
 * Data Maid Dialog class for managing the cleanup dialog interface.
 */
class DataMaidDialog {
    constructor() {
        this.token = null;
        this.container = null;
        this.isScanning = false;

        this.DATA_MAID_CATEGORIES = {
            files: {
                name: t`Files`,
                description: t`Files that are not associated with chat messages or Data Bank. WILL DELETE MANUAL UPLOADS!`,
            },
            images: {
                name: t`Images`,
                description: t`Images that are not associated with chat messages. WILL DELETE MANUAL UPLOADS!`,
            },
            chats: {
                name: t`Chats`,
                description: t`Chat files associated with deleted characters.`,
            },
            groupChats: {
                name: t`Group Chats`,
                description: t`Chat files associated with deleted groups.`,
            },
            avatarThumbnails: {
                name: t`Avatar Thumbnails`,
                description: t`Thumbnails for avatars of missing or deleted characters.`,
            },
            backgroundThumbnails: {
                name: t`Background Thumbnails`,
                description: t`Thumbnails for missing or deleted backgrounds.`,
            },
            personaThumbnails: {
                name: t`Persona Thumbnails`,
                description: t`Thumbnails for missing or deleted personas.`,
            },
            layouts: {
                name: t`Layouts`,
                description: t`Custom layout CSS files uploaded from User Settings. Deleting them removes those layout options.`,
            },
            layoutAssets: {
                name: t`Layout Images`,
                description: t`Uploaded layout images that are not referenced by any custom layout CSS.`,
            },
            chatBackups: {
                name: t`Chat Backups`,
                description: t`Automatically generated chat backups.`,
            },
            settingsBackups: {
                name: t`Settings Backups`,
                description: t`Automatically generated settings backups.`,
            },
        };
    }

    /**
     * Returns a promise that resolves to the Data Maid report.
     * @returns {Promise<DataMaidReportResult>}
     * @private
     */
    async getReport() {
        const response = await fetch('/api/data-maid/report', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error(`Error fetching Data Maid report: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Finalizes the Data Maid process by sending a request to the server.
     * @returns {Promise<void>}
     * @private
     */
    async finalize() {
        const response = await fetch('/api/data-maid/finalize', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ token: this.token }),
        });

        if (!response.ok) {
            throw new Error(`Error finalizing Data Maid: ${response.statusText}`);
        }
    }

    /**
     * Sets up the dialog UI elements and event listeners.
     * @private
     */
    async setupDialogUI() {
        const template = await renderTemplateAsync('dataMaidDialog');
        this.container = document.createElement('div');
        this.container.classList.add('dataMaidDialogContainer');
        this.container.innerHTML = template;

        const startButton = this.container.querySelector('.dataMaidStartButton');
        startButton.addEventListener('click', () => this.handleScanClick());
    }

    /**
     * Handles the scan button click event.
     * @private
     */
    async handleScanClick() {
        if (this.isScanning) {
            toastr.warning(t`The scan is already running. Please wait for it to finish.`);
            return;
        }

        try {
            const resultsList = this.container.querySelector('.dataMaidResultsList');
            resultsList.innerHTML = '';
            this.showSpinner();
            this.isScanning = true;

            const report = await this.getReport();

            this.hideSpinner();
            await this.renderReport(report, resultsList);
            this.token = report.token;
        } catch (error) {
            this.hideSpinner();
            console.error('Error generating Data Maid report:', error);
            toastr.error(appendErrorCode(t`An error has occurred. Check the console for details.`, error));
        } finally {
            this.isScanning = false;
        }
    }

    /**
     * Shows the loading spinner and hides the placeholder.
     * @private
     */
    showSpinner() {
        const spinner = this.container.querySelector('.dataMaidSpinner');
        const placeholder = this.container.querySelector('.dataMaidPlaceholder');
        placeholder.classList.add('displayNone');
        spinner.classList.remove('displayNone');
    }

    /**
     * Hides the loading spinner.
     * @private
     */
    hideSpinner() {
        const spinner = this.container.querySelector('.dataMaidSpinner');
        spinner.classList.add('displayNone');
    }

    /**
     * Renders the Data Maid report into the results list.
     * @param {DataMaidReportResult} report
     * @param {Element} resultsList
     * @private
     */
    async renderReport(report, resultsList) {
        for (const [prop, data] of Object.entries(this.DATA_MAID_CATEGORIES)) {
            const category = await this.renderCategory(prop, data.name, data.description, report.report[prop]);
            if (!category) {
                continue;
            }
            resultsList.appendChild(category);
        }
        this.displayEmptyPlaceholder();
    }

    /**
     * Displays a placeholder message if no items are found in the results list.
     * @private
     */
    displayEmptyPlaceholder() {
        const resultsList = this.container.querySelector('.dataMaidResultsList');
        if (resultsList.children.length === 0) {
            const placeholder = this.container.querySelector('.dataMaidPlaceholder');
            placeholder.classList.remove('displayNone');
            placeholder.textContent = t`No items found to clean up. Come back later!`;
        }
    }

    /**
     * Renders a single Data Maid category into a DOM element.
     * @param {string} prop Property name for the category
     * @param {string} name Name of the category
     * @param {string} description Description of the category
     * @param {import('../../src/endpoints/data-maid.js').DataMaidSanitizedRecord[]} items List of items in the category
     * @return {Promise<Element|null>} A promise that resolves to a DOM element containing the rendered category
     * @private
     */
    async renderCategory(prop, name, description, items) {
        if (!Array.isArray(items) || items.length === 0) {
            return null;
        }

        const viewModel = {
            name: name,
            description: description,
            totalSize: humanFileSize(items.reduce((sum, item) => sum + item.size, 0)),
            totalItems: items.length,
            items: items.sort((a, b) => b.mtime - a.mtime).map(item => ({
                ...item,
                size: humanFileSize(item.size),
                date: timestampToMoment(item.mtime).format('L LT'),
            })),
        };

        const template = await renderTemplateAsync('dataMaidCategory', viewModel);
        const categoryElement = document.createElement('div');
        categoryElement.innerHTML = template;
        const selectAll = categoryElement.querySelector('.dataMaidSelectAll');
        const itemCheckboxes = () => Array.from(categoryElement.querySelectorAll('.dataMaidItemSelect'));
        let deletionPending = false;

        /** Synchronizes selection controls and displayed category totals with the remaining items. */
        const updateCategoryUi = () => {
            const checkboxes = itemCheckboxes();
            const selectedCount = checkboxes.filter(checkbox => checkbox.checked).length;
            selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
            selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
            categoryElement.querySelector('.dataMaidSelectedCount').textContent = t`${selectedCount} selected`;
            categoryElement.querySelector('.dataMaidDeleteSelected').disabled = deletionPending || selectedCount === 0;
            categoryElement.querySelector('.dataMaidCategoryItemCount').textContent = items.length;
            categoryElement.querySelector('.dataMaidCategoryTotalSize').textContent = humanFileSize(items.reduce((sum, item) => sum + item.size, 0));
        };

        /** Prevents overlapping category mutations while a delete request is pending. */
        const setDeletionPending = (pending) => {
            deletionPending = pending;
            categoryElement.querySelectorAll('.dataMaidDeleteSelected, .dataMaidItemDelete, .dataMaidItemSelect, .dataMaidSelectAll')
                .forEach(control => control.disabled = pending);
            const deleteAll = categoryElement.querySelector('.dataMaidDeleteAll');
            deleteAll.classList.toggle('disabled', pending);
            deleteAll.setAttribute('aria-disabled', String(pending));
            updateCategoryUi();
        };

        /** Removes successfully deleted records and refreshes or removes their category. */
        const removeDeletedItems = (hashes) => {
            const deletedHashes = new Set(hashes);
            categoryElement.querySelectorAll('.dataMaidItem').forEach(item => {
                if (deletedHashes.has(item.getAttribute('data-hash'))) {
                    item.remove();
                }
            });
            for (let index = items.length - 1; index >= 0; index--) {
                if (deletedHashes.has(items[index].hash)) {
                    items.splice(index, 1);
                }
            }
            if (items.length === 0) {
                categoryElement.remove();
                this.displayEmptyPlaceholder();
                return;
            }
            updateCategoryUi();
        };

        selectAll.addEventListener('change', () => {
            itemCheckboxes().forEach(checkbox => checkbox.checked = selectAll.checked);
            updateCategoryUi();
        });
        itemCheckboxes().forEach(checkbox => checkbox.addEventListener('change', updateCategoryUi));
        categoryElement.querySelectorAll('.dataMaidItemView').forEach(button => {
            button.addEventListener('click', async () => {
                const item = button.closest('.dataMaidItem');
                const hash = item?.getAttribute('data-hash');
                const itemName = items.find(i => i.hash === hash)?.name;
                if (hash) {
                    await this.view(prop, hash, itemName);
                }
            });
        });
        categoryElement.querySelectorAll('.dataMaidItemDownload').forEach(button => {
            button.addEventListener('click', async () => {
                const item = button.closest('.dataMaidItem');
                const hash = item?.getAttribute('data-hash');
                if (hash) {
                    await this.download(items, hash);
                }
            });
        });
        categoryElement.querySelectorAll('.dataMaidDeleteAll').forEach(button => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (deletionPending) {
                    return;
                }
                setDeletionPending(true);
                try {
                    const confirm = await Popup.show.confirm(t`Are you sure?`, t`This will permanently delete all files in this category. THIS CANNOT BE UNDONE!`);
                    if (!confirm) {
                        return;
                    }

                    const hashes = items.map(item => item.hash).filter(hash => hash);
                    if (await this.delete(hashes)) {
                        removeDeletedItems(hashes);
                    }
                } finally {
                    setDeletionPending(false);
                }
            });

        });
        categoryElement.querySelector('.dataMaidDeleteSelected').addEventListener('click', async () => {
            if (deletionPending) {
                return;
            }
            const hashes = itemCheckboxes()
                .filter(checkbox => checkbox.checked)
                .map(checkbox => checkbox.closest('.dataMaidItem')?.getAttribute('data-hash'))
                .filter(hash => hash);
            if (hashes.length === 0) {
                return;
            }

            setDeletionPending(true);
            try {
                const confirm = await Popup.show.confirm(t`Are you sure?`, t`This will permanently delete the selected files. THIS CANNOT BE UNDONE!`);
                if (!confirm) {
                    return;
                }

                if (await this.delete(hashes)) {
                    removeDeletedItems(hashes);
                }
            } finally {
                setDeletionPending(false);
            }
        });
        categoryElement.querySelectorAll('.dataMaidItemDelete').forEach(button => {
            button.addEventListener('click', async () => {
                if (deletionPending) {
                    return;
                }
                const item = button.closest('.dataMaidItem');
                const hash = item?.getAttribute('data-hash');
                if (hash) {
                    setDeletionPending(true);
                    try {
                        const confirm = await Popup.show.confirm(t`Are you sure?`, t`This will permanently delete the file. THIS CANNOT BE UNDONE!`);
                        if (!confirm) {
                            return;
                        }

                        if (await this.delete([hash])) {
                            removeDeletedItems([hash]);
                        }
                    } finally {
                        setDeletionPending(false);
                    }
                }
            });
        });
        updateCategoryUi();
        return categoryElement;
    }

    /**
     * Constructs the URL for viewing an item by its hash.
     * @param {string} hash Hash of the item to view
     * @returns {string} URL to view the item
     * @private
     */
    getViewUrl(hash) {
        return `/api/data-maid/view?hash=${encodeURIComponent(hash)}&token=${encodeURIComponent(this.token)}`;
    }

    /**
     * Downloads an item by its hash.
     * @param {import('../../src/endpoints/data-maid.js').DataMaidSanitizedRecord[]} items List of items in the category
     * @param {string} hash Hash of the item to download
     * @private
     */
    async download(items, hash) {
        const item = items.find(i => i.hash === hash);
        if (!item) {
            return;
        }
        const url = this.getViewUrl(hash);
        const a = document.createElement('a');
        a.href = url;
        a.download = item?.name || hash;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    /**
     * Opens the item view for a specific hash.
     * @param {string} prop Property name for the category
     * @param {string} hash Item hash to view
     * @param {string} name Name of the item to view
     * @private
     */
    async view(prop, hash, name) {
        const url = this.getViewUrl(hash);
        const isImage = ['images', 'avatarThumbnails', 'backgroundThumbnails', 'layoutAssets'].includes(prop);
        const element = isImage
            ? await this.getViewElement(url, name)
            : await this.getTextViewElement(url);
        await callGenericPopup(element, POPUP_TYPE.DISPLAY, '', { large: true, wide: true });
    }

    /**
     * Deletes an item by its file path hash.
     * @param {string[]} hashes Hashes of items to delete
     * @return {Promise<boolean>} True if the deletion was successful, false otherwise
     * @private
     */
    async delete(hashes) {
        try {
            const response = await fetch('/api/data-maid/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ hashes: hashes, token: this.token }),
            });

            if (!response.ok) {
                throw new Error(`Error deleting item: ${response.statusText}`);
            }

            return true;
        } catch (error) {
            console.error('Error deleting item:', error);
            toastr.error(appendErrorCode(t`An error has occurred. Check the console for details.`, error));
            return false;
        }
    }

    /**
     * Gets a media element for viewing images or videos.
     * @param {string} url View URL
     * @param {string} name Name of the file
     * @returns {Promise<HTMLElement>} Image element
     * @private
     */
    async getViewElement(url, name) {
        const isVideo = VIDEO_EXTENSIONS.includes(name.split('.').pop());
        const mediaElement = document.createElement(isVideo ? 'video' : 'img');
        if (mediaElement instanceof HTMLVideoElement) {
            mediaElement.controls = true;
        }
        mediaElement.src = url;
        mediaElement.classList.add('dataMaidImageView');
        return mediaElement;
    }

    /**
     * Gets an iframe element for viewing text content.
     * @param {string} url View URL
     * @returns {Promise<HTMLTextAreaElement>} Frame element
     * @private
     */
    async getTextViewElement(url) {
        const response = await fetch(url);
        const text = await response.text();
        const element = document.createElement('textarea');
        element.classList.add('dataMaidTextView');
        element.readOnly = true;
        element.textContent = text;
        return element;
    }

    /**
     * Opens the Data Maid dialog and handles the interaction.
     */
    async open() {
        await this.setupDialogUI();
        await callGenericPopup(this.container, POPUP_TYPE.TEXT, '', { wide: true, large: true });

        if (this.token) {
            await this.finalize();
        }
    }
}

export function initDataMaid() {
    const dataMaidButton = document.getElementById('data_maid_button');
    if (!dataMaidButton) {
        console.warn('Data Maid button not found');
        return;
    }

    dataMaidButton.addEventListener('click', () => new DataMaidDialog().open());
}
