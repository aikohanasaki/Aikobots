import assert from 'node:assert/strict';

/** Exercises clip jobs with a synthetic provider response and the smoke server's disposable book. */
export async function testStmbClipJobs(page) {
    let requests = 0;
    let generationGate = null;
    const handler = async route => {
        requests++;
        if (generationGate) await generationGate;
        const text = 'Synthetic necklace facts.';
        const streaming = route.request().postDataJSON().stream;
        await route.fulfill({
            status: 200,
            contentType: streaming ? 'text/event-stream' : 'application/json',
            body: streaming
                ? `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
                : JSON.stringify({ choices: [{ message: { content: text } }] }),
        });
    };
    await page.route('**/api/backends/chat-completions/generate', handler);
    try {
        await page.locator('#top_chat_bar_search').evaluate(element => element.click());
        const picker = page.locator('.chat-extract-picker');
        await picker.locator('input[type=search]').fill('necklace');
        await picker.getByText('Loaded messages: 3', { exact: true }).waitFor();
        await picker.getByRole('button', { name: 'Select loaded results', exact: true }).click();
        await picker.getByRole('button', { name: 'Topical Clip', exact: true }).click();
        await page.locator('#stmb-topical-clip-lorebook-select').selectOption({ label: 'Extractor Smoke' }, { force: true });
        await page.locator('#stmb-topical-clip-topic').fill('Queue Smoke');
        await page.locator('#stmb-topical-clip-generate').click();
        await page.waitForFunction(() => document.querySelector('#stmb-topical-clip-draft')?.value === 'Synthetic necklace facts.');
        assert.equal(await page.locator('#stmb-topical-clip-save').isEnabled(), true);
        assert.equal(await page.locator('#stmb-jobs-rows .stmb-jobs-row').count(), 0);
        assert.equal(requests, 1);

        const saved = page.waitForResponse(response => response.url().endsWith('/api/stmb/create-entry'));
        await page.locator('#stmb-topical-clip-generate-auto-accept').click();
        await page.locator('#stmb-topical-clip-draft').waitFor({ state: 'detached' });
        assert.equal((await saved).ok(), true);
        await page.waitForFunction(() => [...document.querySelectorAll('#stmb-jobs-rows .stmb-jobs-row')].some(row => row.textContent.includes('Topical Clip') && row.textContent.includes('Completed')));
        assert.equal(requests, 2);

        await page.locator('#stmb-menu-item').evaluate(element => element.click());
        await page.locator('dialog[open] .popup-button-custom').filter({ hasText: /^Compaction$/ }).click();
        await page.locator('#stmb-compaction-lorebook-select').selectOption({ label: 'Extractor Smoke' }, { force: true });
        const entry = page.locator('tr[data-entry-uid]').filter({ hasText: 'Queue Smoke' });
        await entry.locator('.stmb-review-entry-action').click();
        await page.locator('#stmb-compact-content').waitFor();
        assert.equal(await page.locator('#stmb-compact-content').inputValue(), 'Synthetic necklace facts.');
        await page.waitForFunction(() => [...document.querySelectorAll('#stmb-jobs-rows .stmb-jobs-row')].some(row => row.textContent.includes('Compaction') && row.textContent.includes('Draft ready')));
        await page.locator('#stmb-compact-content').fill('Edited compacted facts.');
        const uid = await entry.getAttribute('data-entry-uid');
        assert.equal(await page.evaluate(async uid => {
            const response = await fetch('/api/stmb/update-entry-by-uid', {
                method: 'POST', headers: globalThis.SillyTavern.getContext().getRequestHeaders(),
                body: JSON.stringify({ lorebookName: 'Extractor Smoke', storage: 'user', uid, content: 'Intervening synthetic edit.' }),
            });
            return response.ok;
        }, uid), true);
        const conflicted = page.waitForResponse(response => response.url().endsWith('/api/stmb/update-entry-by-uid'));
        await page.locator('dialog[open]').filter({ has: page.locator('#stmb-compact-content') }).locator('.popup-button-ok').click();
        const conflict = await conflicted;
        assert.equal(conflict.status(), 409);
        assert.ok(conflict.request().postDataJSON().expectedContentHash);
        const overwrite = page.locator('dialog[open]').filter({ hasText: 'Overwrite its current content with your compacted draft?' });
        await overwrite.waitFor();
        const replaced = page.waitForResponse(response => response.url().endsWith('/api/stmb/update-entry-by-uid'));
        await overwrite.locator('.popup-button-ok').click();
        const response = await replaced;
        assert.equal(response.ok(), true);
        assert.equal(response.request().postDataJSON().content, 'Edited compacted facts.');
        assert.equal(response.request().postDataJSON().expectedContentHash, '');
        assert.equal(requests, 3);
        await page.locator('#stmb-compact-content').waitFor({ state: 'detached' });
        await page.keyboard.press('Escape');
        await page.locator('#stmb-compaction-lorebook-select').waitFor({ state: 'detached' });
        await page.keyboard.press('Escape');

        // Combine a disabled ordinary Clip with the Topical Clip created above.
        const ordinary = await page.evaluate(async () => {
            const response = await fetch('/api/stmb/create-entry', {
                method: 'POST', headers: globalThis.SillyTavern.getContext().getRequestHeaders(),
                body: JSON.stringify({ lorebookName: 'Extractor Smoke', storage: 'user', title: 'Ordinary Smoke [STMB Clip]', content: 'Synthetic ordinary facts.', entryOverrides: { key: ['ordinary'], keysecondary: ['excluded'], disable: true } }),
            });
            if (!response.ok) throw new Error('Synthetic Clip creation failed.');
            return (await response.json()).entry;
        });
        await page.locator('#stmb-menu-item').evaluate(element => element.click());
        await page.locator('dialog[open] .popup-button-custom').filter({ hasText: /^Topical Clip$/ }).click();
        await page.locator('#stmb-topical-clip-lorebook-select').selectOption({ label: 'Extractor Smoke' }, { force: true });
        await page.locator('#stmb-combine-clips-open').click();
        assert.equal(await page.locator('#stmb-combine-book').inputValue(), 'Extractor Smoke');
        const selectSources = async () => {
            await page.locator('#stmb-combine-sources label').filter({ hasText: 'Ordinary Smoke' }).locator('input').check();
            await page.locator('#stmb-combine-sources label').filter({ hasText: 'Queue Smoke' }).locator('input').check();
        };
        await selectSources();
        assert.equal(await page.locator('#stmb-combine-disable').isChecked(), true);
        assert.ok((await page.locator('#stmb-combine-keywords').textContent()).includes('ordinary'));
        assert.ok(!(await page.locator('#stmb-combine-keywords').textContent()).includes('excluded'));
        await page.locator('#stmb-combine-title').fill('Combined Smoke');

        // A late provider response must not restore a draft invalidated by a title edit.
        let releaseGeneration;
        generationGate = new Promise(resolve => { releaseGeneration = resolve; });
        const generating = page.waitForRequest('**/api/backends/chat-completions/generate');
        await page.locator('#stmb-combine-generate').click();
        await generating;
        assert.equal(await page.locator('#stmb-combine-generate').isDisabled(), true);
        await page.locator('#stmb-combine-title').fill('Combined Reviewed Smoke');
        releaseGeneration();
        generationGate = null;
        await page.waitForFunction(() => !document.querySelector('#stmb-combine-generate').disabled);
        assert.equal(await page.locator('#stmb-combine-draft').inputValue(), '');
        assert.equal(await page.locator('#stmb-combine-save').isDisabled(), true);

        const generateDraft = async () => {
            await page.locator('#stmb-combine-generate').click();
            await page.waitForFunction(() => document.querySelector('#stmb-combine-draft')?.value === 'Synthetic necklace facts.');
        };
        await generateDraft();
        await page.locator('#stmb-combine-draft').fill('Reviewed combined synthetic facts.');
        assert.equal(await page.evaluate(async uid => {
            const response = await fetch('/api/stmb/update-entry-by-uid', {
                method: 'POST', headers: globalThis.SillyTavern.getContext().getRequestHeaders(),
                body: JSON.stringify({ lorebookName: 'Extractor Smoke', storage: 'user', uid, content: 'Changed ordinary synthetic facts.' }),
            });
            return response.ok;
        }, ordinary.uid), true);
        const combineConflict = page.waitForResponse('**/api/stmb/combine-clips');
        await page.locator('#stmb-combine-save').click();
        assert.equal((await combineConflict).status(), 409);
        await page.waitForFunction(() => document.querySelector('#stmb-combine-status')?.textContent.includes('selected Clip changed'));
        assert.equal(await page.locator('#stmb-combine-draft').inputValue(), 'Reviewed combined synthetic facts.');
        assert.equal(await page.locator('#stmb-combine-save').isDisabled(), true);

        await page.locator('#stmb-combine-reload').click();
        await selectSources();
        await generateDraft();
        await page.locator('#stmb-combine-draft').fill(' ');
        assert.equal(await page.locator('#stmb-combine-save').isDisabled(), true);
        await page.locator('#stmb-combine-draft').fill('Reviewed combined synthetic facts.');
        const combined = page.waitForResponse('**/api/stmb/combine-clips');
        await page.locator('#stmb-combine-save').click();
        const combinedResponse = await combined;
        assert.equal(combinedResponse.ok(), true);
        const output = (await combinedResponse.json()).entry;
        assert.ok(output.content.includes('Reviewed combined synthetic facts.'));
        assert.deepEqual(output.keysecondary, []);
        assert.equal(output.data.extensions.aikobots.combined_clips.source_uids.length, 2);
        await page.locator('#stmb-combine-draft').waitFor({ state: 'detached' });
        await page.waitForFunction(() => [...document.querySelector('#stmb-topical-clip-target-select').options].some(option => option.text.includes('Combined Reviewed Smoke')));

        await page.locator('#stmb-combine-clips-open').click();
        await page.locator('#stmb-combine-sources label').filter({ hasText: 'Queue Smoke' }).waitFor();
        assert.ok((await page.locator('#stmb-combine-sources label').filter({ hasText: 'Queue Smoke' }).textContent()).includes('Disabled'));
        await page.keyboard.press('Escape');
        await page.locator('#stmb-combine-draft').waitFor({ state: 'detached' });
        await page.keyboard.press('Escape');
        await page.locator('#stmb-topical-clip-draft').waitFor({ state: 'detached' });
        await page.keyboard.press('Escape');
    } finally {
        await page.unroute('**/api/backends/chat-completions/generate', handler);
    }
}
