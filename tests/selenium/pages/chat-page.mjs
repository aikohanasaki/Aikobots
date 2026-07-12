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
            const hasPreloader = await this.driver.executeScript('return document.getElementById("preloader") !== null;');
            return !hasPreloader;
        }, this.config.timeouts.pageLoadMs);
        await this.driver.wait(until.elementLocated(By.id('top_chat_bar_chat_name')), this.config.timeouts.stepMs);
    }

    async openConnectionProfilesPanel() {
        const toggle = await this.driver.findElement(By.id('top_chat_bar_toggle_connection_profiles'));
        await toggle.click();
        await this.driver.wait(until.elementLocated(By.id('top_chat_connection_profiles_select')), this.config.timeouts.stepMs);
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

    async startNewChat() {
        const button = await this.driver.findElement(By.id('top_chat_bar_new_chat'));
        await button.click();
        await this.driver.wait(until.elementLocated(By.id('dialogue_popup_ok')), this.config.timeouts.stepMs);
        const ok = await this.driver.findElement(By.id('dialogue_popup_ok'));
        await ok.click();
    }

    async renameCurrentChat(newName) {
        const button = await this.driver.findElement(By.id('top_chat_bar_rename_chat'));
        await button.click();
        await this.driver.wait(until.elementLocated(By.id('dialogue_popup_input')), this.config.timeouts.stepMs);

        const input = await this.driver.findElement(By.id('dialogue_popup_input'));
        await input.clear();
        await input.sendKeys(newName);

        const ok = await this.driver.findElement(By.id('dialogue_popup_ok'));
        await ok.click();
    }

    async getCurrentChatName() {
        return this.driver.executeScript(`
            const select = document.getElementById('top_chat_bar_chat_name');
            if (!select || !select.selectedOptions || !select.selectedOptions[0]) return '';
            return (select.selectedOptions[0].textContent || '').trim();
        `);
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
        }, this.config.timeouts.stepMs);
    }

    async getLastMessageText() {
        await this.driver.wait(until.elementLocated(By.css('.last_mes .mes_text')), this.config.timeouts.stepMs);
        const el = await this.driver.findElement(By.css('.last_mes .mes_text'));
        return (await el.getText()).trim();
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
