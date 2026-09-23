import assert from 'node:assert/strict';

/** Exercises all three extractor entry points against a disposable real chat and server. */
export async function testChatExtractor(page) {
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const response = await fetch('/api/characters/create', {
            method: 'POST', headers: context.getRequestHeaders(),
            body: JSON.stringify({ ch_name: 'Extractor Smoke', first_mes: 'A silver necklace lies here.', description: '', personality: '', scenario: '', mes_example: '' }),
        });
        if (!response.ok) throw new Error('Could not create extraction smoke character');
        const avatar = await response.text();
        await context.getCharacters();
        await context.selectCharacterById(context.characters.findIndex(character => character.avatar === avatar));
        const active = globalThis.SillyTavern.getContext();
        for (const message of [
            { name: 'User', is_user: true, mes: 'Unrelated context.' },
            { name: 'Extractor Smoke', is_system: true, mes: 'The silver necklace belonged to Mira. <literal>' },
            { name: 'User', is_user: true, mes: 'Where is the necklace now?' },
        ]) active.chat.push({ ...message, send_date: '2026-09-21T12:00:00.000Z' });
        await active.saveChat();
        await active.reloadCurrentChat();
    });
    const before = await page.evaluate(() => JSON.stringify(globalThis.SillyTavern.getContext().chat));
    await page.locator('#top_chat_bar_search').evaluate(element => element.click());
    const picker = page.locator('.chat-extract-picker');
    await picker.locator('input[type=search]').fill('necklace');
    await picker.getByText('Loaded messages: 3', { exact: true }).waitFor();
    assert.equal(await picker.locator('.chat-extract-result').count(), 3);
    await picker.getByRole('button', { name: 'Select loaded results', exact: true }).click();
    await picker.getByRole('button', { name: 'Topical Clip', exact: true }).click();
    await page.locator('#stmb-topical-clip-extract').waitFor();
    assert.equal(await page.locator('#stmb-topical-clip-topic').inputValue(), 'necklace');
    assert.equal(await page.locator('#stmb-topical-clip-message-mode').inputValue(), 'selection');
    assert.equal(await page.locator('#stmb-topical-clip-include-memories').isChecked(), false);

    await page.locator('#stmb-topical-clip-lorebook-select').selectOption({ label: 'Extractor Smoke' }, { force: true });
    await page.locator('#stmb-topical-clip-mode').selectOption('update');
    await page.locator('#stmb-topical-clip-target-select').selectOption('0');
    const profile = await page.locator('#stmb-topical-clip-profile-select').inputValue();

    await page.locator('#stmb-topical-clip-topic').fill('Keep my topic');
    await page.locator('#stmb-topical-clip-keywords').fill('keep, keys');
    await page.locator('#stmb-topical-clip-include-memories').check();
    await page.locator('#stmb-topical-clip-draft').fill('Old draft');
    await page.locator('#stmb-topical-clip-extract').click();
    assert.equal(await picker.locator('input[type=search]').inputValue(), '');
    await page.keyboard.press('Escape');
    await picker.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#stmb-topical-clip-draft').inputValue(), 'Old draft');
    await page.locator('#stmb-topical-clip-extract').click();
    await picker.locator('input[type=search]').fill('silver');
    await picker.getByText('Loaded messages: 2', { exact: true }).waitFor();
    await picker.getByLabel('Hidden only', { exact: true }).check();
    await picker.getByText('Loaded messages: 1', { exact: true }).waitFor();
    await picker.getByRole('button', { name: 'Select loaded results', exact: true }).focus();
    await page.keyboard.press('Space');
    await picker.getByRole('button', { name: 'Use selected messages', exact: true }).click();
    await picker.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#stmb-topical-clip-topic').inputValue(), 'Keep my topic');
    assert.equal(await page.locator('#stmb-topical-clip-keywords').inputValue(), 'keep, keys');
    assert.equal(await page.locator('#stmb-topical-clip-include-memories').isChecked(), true);
    assert.equal(await page.locator('#stmb-topical-clip-draft').inputValue(), '');
    assert.equal(await page.locator('#stmb-topical-clip-selection-count').textContent(), 'Selected messages: 1');
    assert.equal(await page.locator('#stmb-topical-clip-mode').inputValue(), 'update');
    assert.equal(await page.locator('#stmb-topical-clip-target-select').inputValue(), '0');
    assert.equal(await page.locator('#stmb-topical-clip-profile-select').inputValue(), profile);
    await page.locator('#stmb-topical-clip-edit-selection').click();
    await picker.getByText('Selected messages: 1', { exact: true }).waitFor();
    assert.equal(await picker.locator('input[type=search]').inputValue(), 'silver');
    await picker.getByRole('button', { name: 'Search', exact: true }).focus();
    await page.keyboard.press('Escape');
    await picker.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await page.locator('#stmb-topical-clip-extract').waitFor({ state: 'detached' });

    await page.locator('#chat .mes_text').last().evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const start = node.textContent.indexOf('necklace');
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + 'necklace'.length);
            document.getSelection().removeAllRanges();
            document.getSelection().addRange(range);
            break;
        }
    });
    await page.locator('.stmb_floating_clip_button').getByRole('button', { name: 'Extract', exact: true }).click();
    await picker.getByText('Loaded messages: 3', { exact: true }).waitFor();
    assert.equal(await picker.locator('input[type=search]').inputValue(), 'necklace');
    await picker.getByRole('button', { name: 'Search', exact: true }).focus();
    await page.keyboard.press('Escape');
    await picker.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => JSON.stringify(globalThis.SillyTavern.getContext().chat)), before);
}
