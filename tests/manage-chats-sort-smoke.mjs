import assert from 'node:assert/strict';

/** Exercises the real Manage Chats controls with synthetic summaries and existing row actions. */
export async function testManageChatsSorting(page) {
    await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const response = await fetch('/api/characters/create', {
            method: 'POST', headers: context.getRequestHeaders(),
            body: JSON.stringify({ ch_name: 'Sorting Smoke', first_mes: 'Synthetic greeting.' }),
        });
        if (!response.ok) throw new Error('Could not create sorting smoke character');
        const avatar = await response.text();
        await context.getCharacters();
        const refreshed = globalThis.SillyTavern.getContext();
        await refreshed.selectCharacterById(refreshed.characters.findIndex(character => character.avatar === avatar));
        globalThis.SillyTavern.getContext().groups.push({ id: 'sorting-smoke', name: 'Sorting group', members: [avatar], chats: [], chat_id: '' });
    });
    const summaries = [
        { file_name: 'beta.sqlite', file_size: '1 KB', file_size_bytes: 1025, message_count: 2, last_mes: 200 },
        { file_name: 'Alpha.sqlite', file_size: '1 KB', file_size_bytes: 1024, message_count: 10, last_mes: 100 },
    ];
    let searches = 0;
    const searchHandler = route => { searches++; return route.fulfill({ json: summaries }); };
    const orphanHandler = route => route.fulfill({ json: [{
        orphan_key: 'Deleted Sorting', direct_chats: summaries,
        related_groups: [
            { id: 'sorting-smoke', name: 'First group', chats: summaries },
            { id: 'another-group', name: 'Second group', chats: summaries },
        ],
    }] });
    await page.route('**/api/chats/search', searchHandler);
    await page.route('**/api/chats/orphaned', orphanHandler);
    const names = () => page.locator('#select_chat_div .select_chat_block_filename').allTextContents();
    const field = page.locator('#manage_chats_sort_field');
    const direction = page.locator('#manage_chats_sort_direction');
    const open = async () => {
        await page.locator('#top_chat_bar_chat_manager').evaluate(button => button.click());
        await page.locator('#select_chat_div .select_chat_block').first().waitFor();
    };
    try {
        await open();
        assert.equal(await field.inputValue(), 'last_mes');
        assert.equal(await direction.inputValue(), 'desc');
        assert.deepEqual(await names(), ['beta.sqlite', 'Alpha.sqlite']);
        const searched = page.waitForResponse(response => response.url().endsWith('/api/chats/search') && response.request().postDataJSON().query === 'needle');
        await page.locator('#select_chat_search').fill('needle');
        await searched;
        await page.waitForFunction(() => document.querySelectorAll('#select_chat_div .select_chat_block').length === 2);
        const beforeSorting = searches;
        await field.selectOption('file_size_bytes');
        await direction.selectOption('asc');
        assert.deepEqual(await names(), ['Alpha.sqlite', 'beta.sqlite']);
        assert.equal(await page.locator('#select_chat_search').inputValue(), 'needle');
        assert.equal(searches, beforeSorting);

        await page.locator('#manage_chats_bulk_select_button').click();
        await page.locator('#select_chat_div .select_chat_block').first().click();
        await page.locator('#select_chat_div .select_chat_block').first().evaluate(row => { row.dataset.sortSmokeIdentity = 'selected'; });
        await direction.selectOption('desc');
        assert.equal(await page.locator('#select_chat_div .manage_chats_bulk_selected[data-sort-smoke-identity="selected"]').count(), 1);
        assert.match(await page.locator('#manage_chats_bulk_selected_count').textContent(), /1 selected/);
        await page.locator('#manage_chats_bulk_cancel').click();
        await field.selectOption('message_count');
        assert.deepEqual(await names(), ['Alpha.sqlite', 'beta.sqlite']);

        assert.equal(await page.locator('#manage_chats_owner_select option[value="group:sorting-smoke"]').count(), 1);
        await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/api/chats/search') && response.request().postDataJSON().group_id === 'sorting-smoke'),
            page.locator('#manage_chats_owner_select').selectOption('group:sorting-smoke', { force: true, timeout: 10000 }),
        ]);
        await page.waitForFunction(() => document.querySelector('#select_chat_div .select_chat_block_filename')?.textContent === 'Alpha.sqlite');
        assert.equal(await field.inputValue(), 'message_count');

        await page.locator('#manage_chats_mode_switch').click();
        await page.waitForFunction(() => document.querySelectorAll('#select_chat_div .select_chat_block').length === 6);
        const saved = page.waitForResponse(response => {
            if (!response.url().endsWith('/api/settings/save')) return false;
            const preferences = response.request().postDataJSON().accountStorage;
            return preferences?.ManageChats_sort_field === 'file_name' && preferences?.ManageChats_sort_direction === 'asc';
        });
        await field.selectOption('file_name');
        await direction.selectOption('asc');
        assert.deepEqual(await names(), ['Alpha.sqlite', 'beta.sqlite', 'Alpha.sqlite', 'beta.sqlite', 'Alpha.sqlite', 'beta.sqlite']);
        assert.deepEqual(await page.locator('#select_chat_div').evaluate(container => [...container.children].map(child =>
            child.querySelector('.select_chat_block_filename')?.textContent || child.textContent)),
        ['Character chats', 'Alpha.sqlite', 'beta.sqlite', 'Group chats', 'First group', 'Alpha.sqlite', 'beta.sqlite', 'Second group', 'Alpha.sqlite', 'beta.sqlite']);
        const orphanSearch = page.waitForResponse(response => response.url().endsWith('/api/chats/orphaned') && response.request().postDataJSON().query === 'needle');
        await page.locator('#select_chat_search').fill('needle');
        await orphanSearch;
        await page.waitForFunction(() => document.querySelectorAll('#select_chat_div .select_chat_block').length === 6);
        assert.deepEqual(await names(), ['Alpha.sqlite', 'beta.sqlite', 'Alpha.sqlite', 'beta.sqlite', 'Alpha.sqlite', 'beta.sqlite']);

        await page.locator('#select_chat_cross').click();
        await page.locator('#shadow_select_chat_popup').waitFor({ state: 'hidden' });
        await open();
        assert.equal(await field.inputValue(), 'file_name');
        assert.equal(await direction.inputValue(), 'asc');
        const viewport = page.viewportSize();
        await page.setViewportSize({ width: 390, height: 800 });
        for (const control of [field, direction]) {
            const bounds = await control.boundingBox();
            assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.height > 0, 'Sort controls fit a narrow screen');
        }
        await page.setViewportSize(viewport);
        assert.deepEqual(await names(), ['Alpha.sqlite', 'beta.sqlite']);
        assert.deepEqual(await page.evaluate(() => {
            const storage = globalThis.SillyTavern.getContext().accountStorage;
            return [storage.getItem('ManageChats_sort_field'), storage.getItem('ManageChats_sort_direction')];
        }), ['file_name', 'asc']);
        // Reload forces the controls to initialize from persisted account preferences.
        await saved;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(globalThis.SillyTavern?.getContext().characters.some(character => character.name === 'Sorting Smoke')));
        await page.evaluate(async () => {
            const context = globalThis.SillyTavern.getContext();
            await context.selectCharacterById(context.characters.findIndex(character => character.name === 'Sorting Smoke'));
        });
        await open();
        assert.equal(await field.inputValue(), 'file_name');
        assert.equal(await direction.inputValue(), 'asc');
    } finally {
        await page.locator('#select_chat_cross').evaluate(button => button.click());
        await page.unroute('**/api/chats/search', searchHandler);
        await page.unroute('**/api/chats/orphaned', orphanHandler);
    }
}
