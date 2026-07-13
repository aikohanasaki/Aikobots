import fs from 'node:fs';
import path from 'node:path';

import { By, until } from 'selenium-webdriver';

export class ChatPage {
    constructor({ driver, config }) {
        this.driver = driver;
        this.config = config;
    }

    async gotoAndWaitForReady() {
        await this.driver.get(this.config.baseUrl);
        await this.driver.wait(until.elementLocated(By.id('top_chat_bar')), this.config.timeouts.stepMs);
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const preloader = document.getElementById('preloader');
                if (!preloader) return true;
                const hiddenByClass = preloader.classList.contains('loader-hidden');
                const hiddenByStyle = getComputedStyle(preloader).display === 'none' || getComputedStyle(preloader).visibility === 'hidden';
                return hiddenByClass || hiddenByStyle;
            `);
        }, this.config.timeouts.pageLoadMs);
        await this.driver.wait(until.elementLocated(By.id('top_chat_bar_chat_name')), this.config.timeouts.stepMs);
    }

    async openConnectionProfilesPanel() {
        const toggle = await this.driver.findElement(By.id('top_chat_bar_toggle_connection_profiles'));
        await toggle.click();
        await this.driver.wait(until.elementLocated(By.id('top_chat_connection_profiles_select')), this.config.timeouts.stepMs);
    }

    async closeConnectionProfilesPanel() {
        const isVisible = await this.driver.executeScript(`
            const panel = document.getElementById('top_chat_connection_profiles');
            return panel ? panel.classList.contains('visible') : false;
        `);

        if (!isVisible) {
            return;
        }

        const toggle = await this.driver.findElement(By.id('top_chat_bar_toggle_connection_profiles'));
        await toggle.click();
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const panel = document.getElementById('top_chat_connection_profiles');
                return panel ? !panel.classList.contains('visible') : true;
            `);
        }, this.config.timeouts.stepMs);
    }

    async readConnectionProfileOptions() {
        const select = await this.driver.findElement(By.id('top_chat_connection_profiles_select'));
        const options = await select.findElements(By.css('option'));
        const values = [];

        for (const option of options) {
            values.push((await option.getText()).trim());
        }

        return values.filter(Boolean);
    }

    async selectConnectionProfileByName(profileName) {
        const success = await this.driver.executeScript(`
            const select = document.getElementById('top_chat_connection_profiles_select');
            if (!select) return false;
            const option = Array.from(select.options).find(o => (o.textContent || '').trim() === arguments[0]);
            if (!option) return false;
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        `, profileName);

        if (!success) {
            throw new Error(`Connection profile not found in UI: ${profileName}`);
        }
    }

    async getSelectedConnectionProfileName() {
        return this.driver.executeScript(`
            const select = document.getElementById('top_chat_connection_profiles_select');
            if (!select || !select.selectedOptions || !select.selectedOptions[0]) return '';
            return (select.selectedOptions[0].textContent || '').trim();
        `);
    }

    async clickElementById(id) {
        const element = await this.driver.findElement(By.id(id));
        await this.driver.executeScript('arguments[0].scrollIntoView({ block: "center", inline: "center" });', element);

        try {
            await element.click();
        } catch {
            await this.driver.executeScript('arguments[0].click();', element);
        }
    }

    async startNewChat() {
        await this.clickElementById('top_chat_bar_new_chat');
        await this.driver.wait(until.elementLocated(By.id('dialogue_popup_ok')), this.config.timeouts.stepMs);
        await this.clickElementById('dialogue_popup_ok');
    }

    async waitForRenameReady() {
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const button = document.getElementById('top_chat_bar_rename_chat');
                if (!button) return false;
                const disabled = button.disabled || button.classList.contains('not-in-chat') || button.getAttribute('aria-disabled') === 'true';
                return !disabled;
            `);
        }, this.config.timeouts.responseMs);
    }

    async renameCurrentChat(newName) {
        await this.waitForRenameReady();

        const opened = await this.driver.executeScript(`
            const button = document.getElementById('top_chat_bar_rename_chat');
            if (!button) return false;
            button.click();
            return true;
        `);

        if (!opened) {
            throw new Error('Rename button is not available.');
        }

        await this.driver.wait(until.elementLocated(By.css('dialog.popup[open]')), this.config.timeouts.stepMs);
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const input = document.querySelector('dialog.popup[open] textarea.popup-input[data-result="1"]');
                if (!input) return false;
                const style = getComputedStyle(input);
                const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                return visible && !input.disabled;
            `);
        }, this.config.timeouts.stepMs);

        const input = await this.driver.findElement(By.css('dialog.popup[open] textarea.popup-input[data-result="1"]'));

        try {
            await this.driver.executeScript('arguments[0].focus(); arguments[0].click();', input);
            await input.clear();
            await input.sendKeys(newName);
        } catch {
            await this.driver.executeScript(`
                const input = arguments[0];
                input.focus();
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.value = arguments[1];
                input.dispatchEvent(new Event('input', { bubbles: true }));
            `, input, newName);
        }

        const saveButton = await this.driver.findElement(By.css('dialog.popup[open] .popup-button-ok[data-result="1"]'));
        await this.driver.executeScript('arguments[0].click();', saveButton);
    }

    async waitForActiveChatReady() {
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const select = document.getElementById('top_chat_bar_chat_name');
                if (!select || !select.selectedOptions || !select.selectedOptions[0]) return false;
                const selected = (select.selectedOptions[0].textContent || '').trim();
                if (!selected || selected === 'No chat selected') return false;
                return !select.disabled;
            `);
        }, this.config.timeouts.stepMs);
    }

    async getCurrentChatName() {
        return this.driver.executeScript(`
            const select = document.getElementById('top_chat_bar_chat_name');
            if (!select || !select.selectedOptions || !select.selectedOptions[0]) return '';
            return (select.selectedOptions[0].textContent || '').trim();
        `);
    }

    async getSelectedCharacterName() {
        return this.driver.executeScript(`
            const el = document.querySelector('#rm_button_selected_ch h2');
            return el ? (el.textContent || '').trim() : '';
        `);
    }

    async waitForSelectedCharacterName(namePart) {
        const normalized = String(namePart || '').trim().toLowerCase();
        await this.driver.wait(async () => {
            const selectedName = await this.getSelectedCharacterName();
            return selectedName.toLowerCase().includes(normalized);
        }, this.config.timeouts.responseMs);
    }

    async openCharactersPanel() {
        await this.clickElementById('rm_button_characters');
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const block = document.getElementById('rm_print_characters_block');
                return block ? getComputedStyle(block).display !== 'none' : false;
            `);
        }, this.config.timeouts.stepMs);
    }

    async characterExistsByName(characterName) {
        const normalized = String(characterName || '').trim().toLowerCase();
        return this.driver.executeScript(`
            const expected = arguments[0];
            const names = Array.from(document.querySelectorAll('#rm_print_characters_block .character_select .ch_name'))
                .map(el => (el.textContent || '').trim().toLowerCase())
                .filter(Boolean);
            return names.includes(expected);
        `, normalized);
    }

    async ensureCharacterExistsOrImport(characterName, absoluteCharacterPath) {
        await this.openCharactersPanel();

        const existsBeforeImport = await this.characterExistsByName(characterName);
        if (existsBeforeImport) {
            return {
                characterName,
                imported: false,
                importPath: absoluteCharacterPath,
            };
        }

        const importInput = await this.driver.findElement(By.id('character_import_file'));
        await importInput.sendKeys(absoluteCharacterPath);

        await this.driver.wait(async () => {
            return this.characterExistsByName(characterName);
        }, this.config.timeouts.responseMs);

        return {
            characterName,
            imported: true,
            importPath: absoluteCharacterPath,
        };
    }

    resolveSmokeCharacterImportPath(fileName) {
        const testingPath = path.resolve(process.cwd(), 'testing', 'selenium', fileName);
        if (fs.existsSync(testingPath)) {
            return testingPath;
        }

        const testsPath = path.resolve(process.cwd(), 'tests', 'selenium', fileName);
        if (fs.existsSync(testsPath)) {
            return testsPath;
        }

        throw new Error(`Smoke character import file not found: ${testingPath} or ${testsPath}`);
    }

    async openManageChats() {
        const button = await this.driver.findElement(By.id('top_chat_bar_chat_manager'));
        await button.click();
        await this.driver.wait(until.elementLocated(By.id('shadow_select_chat_popup')), this.config.timeouts.stepMs);
        await this.driver.wait(async () => {
            const display = await this.driver.executeScript('const el = document.getElementById("shadow_select_chat_popup"); return el ? getComputedStyle(el).display : "none";');
            return display !== 'none';
        }, this.config.timeouts.stepMs);
    }

    async openOptionsMenu() {
        await this.clickElementById('options_button');
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const options = document.getElementById('options');
                return options ? getComputedStyle(options).display !== 'none' : false;
            `);
        }, this.config.timeouts.stepMs);
    }

    async openRightPanelGroupEditor() {
        const panelOpen = await this.driver.executeScript(`
            const panel = document.getElementById('right-nav-panel');
            return panel ? panel.classList.contains('openDrawer') : false;
        `);

        if (!panelOpen) {
            await this.clickElementById('rightNavDrawerIcon');
            await this.driver.wait(async () => {
                return this.driver.executeScript(`
                    const panel = document.getElementById('right-nav-panel');
                    return panel ? panel.classList.contains('openDrawer') : false;
                `);
            }, this.config.timeouts.stepMs);
        }

        await this.clickElementById('rm_button_group_chats');
        await this.driver.wait(until.elementLocated(By.id('rm_group_chats_block')), this.config.timeouts.stepMs);
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const block = document.getElementById('rm_group_chats_block');
                return block ? getComputedStyle(block).display !== 'none' : false;
            `);
        }, this.config.timeouts.stepMs);
    }

    async convertCurrentChatToGroup() {
        await this.openOptionsMenu();
        await this.clickElementById('option_convert_to_group');

        await this.driver.wait(until.elementLocated(By.css('dialog.popup[open]')), this.config.timeouts.stepMs);
        const dialog = await this.driver.findElement(By.css('dialog.popup[open]'));
        const confirmButton = await dialog.findElement(By.css('.popup-button-ok[data-result="1"]'));
        await this.driver.executeScript('arguments[0].click();', confirmButton);

        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const toasts = Array.from(document.querySelectorAll('#toast-container .toast-message'));
                return toasts.some(el => /successfully converted/i.test((el.textContent || '').trim()));
            `);
        }, this.config.timeouts.responseMs);
    }

    async addFirstAvailableMemberToGroup() {
        await this.openRightPanelGroupEditor();

        const beforeGroupCount = await this.driver.findElements(By.css('#rm_group_members .group_member'));

        await this.clickElementById('groupAddMemberListToggle');
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const list = document.getElementById('rm_group_add_members');
                if (!list) return false;
                return getComputedStyle(list).display !== 'none';
            `);
        }, this.config.timeouts.stepMs);

        await this.driver.wait(until.elementLocated(By.css('#rm_group_add_members .group_member [title="Add to group"][data-action="add"]')), this.config.timeouts.responseMs);

        const candidateChids = await this.driver.executeScript(`
            const rows = Array.from(document.querySelectorAll('#rm_group_add_members .group_member'));
            return rows
                .filter(row => {
                    const name = (row.querySelector('.ch_name')?.textContent || '').trim();
                    const addButton = row.querySelector('[title="Add to group"][data-action="add"]');
                    return Boolean(addButton) && name && !/assistant/i.test(name);
                })
                .map(row => String(row.getAttribute('data-chid') || ''))
                .filter(Boolean);
        `);

        if (candidateChids.length < 2) {
            throw new Error(`Expected at least 2 non-Assistant add candidates, but found ${candidateChids.length}.`);
        }

        const addedChids = candidateChids.slice(0, 2);

        for (const chid of addedChids) {
            const addButton = await this.driver.findElement(By.css(`#rm_group_add_members .group_member[data-chid="${chid}"] [title="Add to group"][data-action="add"]`));
            await this.driver.executeScript('arguments[0].scrollIntoView({ block: "center", inline: "center" });', addButton);
            try {
                await addButton.click();
            } catch {
                await this.driver.executeScript('arguments[0].click();', addButton);
            }
        }

        await this.driver.wait(async () => {
            const rows = await this.driver.findElements(By.css('#rm_group_members .group_member'));
            return rows.length >= beforeGroupCount.length + 2;
        }, this.config.timeouts.responseMs);

        return { addedCount: addedChids.length, addedChids };
        }

        async triggerGroupMemberSpeakByChid(chid) {
        await this.openRightPanelGroupEditor();

        const clicked = await this.driver.executeScript(`
            const targetChid = String(arguments[0]);
            const row = document.querySelector('#rm_group_members .group_member[data-chid="' + targetChid + '"]')
                || document.querySelector('#rm_group_add_members .group_member[data-chid="' + targetChid + '"]');
            if (!row) return false;

            const button = row.querySelector('[title="Trigger a message from this character"][data-action="speak"]')
                || row.querySelector('[data-action="speak"]');
            if (!button) return false;

            button.scrollIntoView({ block: 'center', inline: 'center' });
            button.click();
            return true;
        `, chid);

        if (!clicked) {
            throw new Error(`No speak button found for group member chid=${chid}.`);
        }
        }

    async getGroupSpeakButtonCount() {
        await this.openRightPanelGroupEditor();
        const buttons = await this.driver.findElements(By.css('#rm_group_members .group_member .right_menu_button.fa-solid.fa-lg.fa-comment.interactable[data-action="speak"]'));
        return buttons.length;
    }

    async triggerFirstGroupMemberChatButton() {
        await this.openRightPanelGroupEditor();
        const clicked = await this.driver.executeScript(`
            const rows = Array.from(document.querySelectorAll('#rm_group_members .group_member'));
            const targetRow = rows.find(row => {
                const name = (row.querySelector('.ch_name')?.textContent || '').trim();
                return name && !/assistant/i.test(name);
            });
            if (!targetRow) return false;

            const button = targetRow.querySelector('[data-action="speak"][title="Trigger a message from this character"]')
                || targetRow.querySelector('[data-action="speak"]');
            if (!button) return false;

            button.scrollIntoView({ block: 'center', inline: 'center' });
            button.click();
            return true;
        `);

        if (!clicked) {
            throw new Error('No non-Assistant group member chat button available.');
        }
    }

    async triggerSpeakOnceOnGroupMember(index) {
        await this.openRightPanelGroupEditor();
        const buttons = await this.driver.findElements(By.css('#rm_group_members .group_member .right_menu_button.fa-solid.fa-lg.fa-comment.interactable[data-action="speak"]'));
        if (index < 0 || index >= buttons.length) {
            throw new Error(`Speak button index out of range: ${index} (count=${buttons.length})`);
        }

        await this.driver.executeScript('arguments[0].click();', buttons[index]);
    }

    async importChatFixture(absoluteFixturePath) {
        const importButton = await this.driver.findElement(By.id('chat_import_button'));
        await importButton.click();
        const input = await this.driver.findElement(By.id('chat_import_file'));
        await input.sendKeys(absoluteFixturePath);
    }

    async waitForChatInManageList(namePart) {
        await this.driver.wait(async () => {
            const rows = await this.driver.findElements(By.css('.select_chat_block_filename'));
            for (const row of rows) {
                const text = (await row.getText()).trim();
                if (text.includes(namePart)) {
                    return true;
                }
            }
            return false;
        }, this.config.timeouts.stepMs);
    }

    async exportChatJsonlByName(namePart) {
        const row = await this.driver.findElement(By.xpath(`//div[contains(@class,'select_chat_block_wrapper')][.//small[contains(@class,'select_chat_block_filename') and contains(normalize-space(.), ${JSON.stringify(namePart)})]]`));
        const button = await row.findElement(By.css('.exportRawChatButton'));
        await button.click();
    }

    async openChatByName(namePart) {
        const row = await this.driver.findElement(By.xpath(`//div[contains(@class,'select_chat_block_wrapper')][.//small[contains(@class,'select_chat_block_filename') and contains(normalize-space(.), ${JSON.stringify(namePart)})]]`));
        const clickable = await row.findElement(By.css('.select_chat_block'));
        await clickable.click();
    }

    async waitForCurrentChatContains(namePart) {
        await this.driver.wait(async () => {
            const current = await this.getCurrentChatName();
            return current.includes(namePart);
        }, this.config.timeouts.responseMs);
    }

    async waitForCurrentChatNotTemporary() {
        await this.driver.wait(async () => {
            const current = await this.getCurrentChatName();
            return current && !current.includes('(Temporary Chat)');
        }, this.config.timeouts.responseMs);
    }

    async getLastMessageText() {
        await this.driver.wait(until.elementLocated(By.css('.last_mes .mes_text')), this.config.timeouts.stepMs);
        const el = await this.driver.findElement(By.css('.last_mes .mes_text'));
        return (await el.getText()).trim();
    }

    async countAssistantMessages() {
        return this.driver.executeScript(`
            return Array.from(document.querySelectorAll('.mes[is_user="false"]'))
                .filter(el => String(el.getAttribute('is_system')) !== 'true')
                .length;
        `);
    }

    async countUserMessages() {
        return this.driver.executeScript(`
            return Array.from(document.querySelectorAll('.mes[is_user="true"]'))
                .filter(el => String(el.getAttribute('is_system')) !== 'true')
                .length;
        `);
    }

    async getConnectionStatusText() {
        return this.driver.executeScript(`
            const el = document.getElementById('top_chat_connection_profiles_status');
            return el ? (el.textContent || '').trim() : '';
        `);
    }

    async waitForConnectionReady() {
        await new Promise(resolve => setTimeout(resolve, 3_000));
    }

    async waitForSendReady() {
        await this.driver.wait(async () => {
            return this.driver.executeScript(`
                const textarea = document.getElementById('send_textarea');
                const sendButton = document.getElementById('send_but');
                if (!textarea || !sendButton) return false;
                const textareaDisabled = textarea.disabled || textarea.readOnly;
                const buttonHidden = getComputedStyle(sendButton).display === 'none' || getComputedStyle(sendButton).visibility === 'hidden';
                return !textareaDisabled && !buttonHidden;
            `);
        }, this.config.timeouts.stepMs);
    }

    async runSlashCommand(commandText) {
        await this.waitForSendReady();
        const textarea = await this.driver.findElement(By.id('send_textarea'));
        await textarea.click();
        await textarea.clear();
        await textarea.sendKeys(commandText);
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.clickElementById('send_but');

        await this.driver.wait(async () => {
            const currentValue = await this.driver.executeScript(`
                const ta = document.getElementById('send_textarea');
                return ta ? String(ta.value || '') : '';
            `);
            return currentValue.length === 0;
        }, this.config.timeouts.responseMs);
    }

    async sendMessage(text) {
        await this.waitForSendReady();
        const textarea = await this.driver.findElement(By.id('send_textarea'));
        await textarea.click();
        await textarea.clear();
        await textarea.sendKeys(text);
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.clickElementById('send_but');
    }

    async waitForUserMessageSent(previousUserCount, timeoutMs = this.config.timeouts.stepMs) {
        await this.driver.wait(async () => {
            const currentCount = await this.countUserMessages();
            return currentCount > previousUserCount;
        }, timeoutMs);
    }

    async sendMessageWithRetry(text, previousUserCount, attempts = 3) {
        let lastError = null;

        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                await this.sendMessage(text);
                await this.waitForUserMessageSent(previousUserCount, 8_000);
                return { sent: true, attempt: attempt + 1 };
            } catch (error) {
                lastError = error;
                await new Promise(resolve => setTimeout(resolve, 2_000));
            }
        }

        throw lastError || new Error('Failed to send message after retries.');
    }

    async waitForAssistantResponse(previousAssistantCount) {
        await this.driver.wait(async () => {
            const currentCount = await this.countAssistantMessages();
            return currentCount > previousAssistantCount;
        }, this.config.timeouts.responseMs);

        await this.driver.wait(async () => {
            const state = await this.driver.executeScript(`
                const messages = Array.from(document.querySelectorAll('.mes[is_user="false"]'))
                    .filter(el => String(el.getAttribute('is_system')) !== 'true');
                const last = messages[messages.length - 1];
                const text = last?.querySelector('.mes_text')?.innerText?.trim() || '';
                const stop = document.getElementById('mes_stop');
                const generating = stop ? getComputedStyle(stop).display !== 'none' : false;
                const nonPlaceholder = text.length > 0 && text !== '…' && text !== '...';
                return { assistantCount: messages.length, text, generating, nonPlaceholder };
            `);

            return state.nonPlaceholder && !state.generating;
        }, this.config.timeouts.responseMs);

        let stableText = '';
        let stableTicks = 0;
        const stableTarget = 3;
        const stableStarted = Date.now();

        while (stableTicks < stableTarget && (Date.now() - stableStarted) < this.config.timeouts.responseMs) {
            const state = await this.driver.executeScript(`
                const messages = Array.from(document.querySelectorAll('.mes[is_user="false"]'))
                    .filter(el => String(el.getAttribute('is_system')) !== 'true');
                const last = messages[messages.length - 1];
                const text = last?.querySelector('.mes_text')?.innerText?.trim() || '';
                const stop = document.getElementById('mes_stop');
                const generating = stop ? getComputedStyle(stop).display !== 'none' : false;
                return { assistantCount: messages.length, text, generating };
            `);

            if (!state.generating && state.text && state.text !== '…' && state.text !== '...') {
                if (state.text === stableText) {
                    stableTicks += 1;
                } else {
                    stableText = state.text;
                    stableTicks = 1;
                }
            } else {
                stableTicks = 0;
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (stableTicks < stableTarget) {
            throw new Error('Assistant response did not stabilize before timeout.');
        }

        return this.driver.executeScript(`
            const messages = Array.from(document.querySelectorAll('.mes[is_user="false"]'))
                .filter(el => String(el.getAttribute('is_system')) !== 'true');
            const last = messages[messages.length - 1];
            const text = last?.querySelector('.mes_text')?.innerText?.trim() || '';
            return { assistantCount: messages.length, responseText: text };
        `);
    }

    async swipeLastMessageRight() {
        const el = await this.driver.findElement(By.css('.last_mes .swipe_right'));
        await el.click();
    }

    async swipeLastMessageLeft() {
        const el = await this.driver.findElement(By.css('.last_mes .swipe_left'));
        await el.click();
    }

    resolveFixturePath(fileName) {
        return path.resolve(process.cwd(), 'tests', 'selenium', 'fixtures', fileName);
    }
}
