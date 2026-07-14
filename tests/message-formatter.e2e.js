describe('MessageFormatter integration', () => {
    beforeEach(async () => {
        await page.goto(global.ST_URL);
        await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 0 });
    });

    it('leaves normal message rendering unchanged when no hooks are registered', async () => {
        const html = await page.evaluate(() => {
            const context = window.SillyTavern.getContext();
            return context.messageFormatting('Plain **bold** text', 'Alice', false, false, -1, {}, false);
        });

        expect(html).toBe('<p>Plain <strong>bold</strong> text</p>');
    });

    it('does not persist hook-modified text back into chat data', async () => {
        const result = await page.evaluate(() => {
            const context = window.SillyTavern.getContext();
            const marker = '__message_formatter_render_only__';

            if (context.chat.length === 0) {
                context.chat.push({
                    name: 'System',
                    mes: 'placeholder',
                    is_system: true,
                    is_user: false,
                    extra: {},
                });
            }

            const messageId = context.chat.length;
            const message = {
                name: 'Alice',
                mes: 'Persist source',
                is_system: false,
                is_user: false,
                extra: {},
            };
            context.chat.push(message);

            context.messageFormatter.addHook(text => `${text} ${marker}`, {
                stage: context.messageFormatter.stage.BEFORE_REGEX,
                order: context.messageFormatter.order.NORMAL,
            });

            const rendered = context.messageFormatting(message.mes, message.name, message.is_system, message.is_user, messageId, {}, false);

            return {
                rendered,
                stored: context.chat[messageId].mes,
                marker,
            };
        });

        expect(result.rendered).toContain(result.marker);
        expect(result.stored).toBe('Persist source');
    });
});
