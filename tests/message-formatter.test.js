import { beforeEach, describe, expect, it, jest } from '@jest/globals';

async function importFreshFormatter() {
    jest.resetModules();
    return await import('../public/scripts/message-formatter.js');
}

describe('MessageFormatter', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    it('exports stage and order constants on the singleton', async () => {
        const { MessageFormatter, formatting_stage, hook_order } = await importFreshFormatter();

        expect(formatting_stage).toEqual({
            BEFORE_REGEX: 'beforeRegex',
            AFTER_REGEX: 'afterRegex',
            AFTER_MARKDOWN: 'afterMarkdown',
        });
        expect(hook_order).toMatchObject({
            EARLIEST: 0,
            EARLY: 10,
            NORMAL: 50,
            LATE: 90,
            LATEST: 100,
        });
        expect(MessageFormatter.stage).toBe(formatting_stage);
        expect(MessageFormatter.order).toBe(hook_order);
    });

    it('validates hook registration', async () => {
        const { MessageFormatter, formatting_stage } = await importFreshFormatter();

        expect(() => MessageFormatter.addHook('not a function')).toThrow(TypeError);
        expect(() => MessageFormatter.addHook(async text => text)).toThrow(TypeError);
        expect(() => MessageFormatter.addHook(text => text, { stage: 'missing' })).toThrow(RangeError);
        expect(() => MessageFormatter.addHook(text => text, { order: Number.NaN })).toThrow(TypeError);
        expect(() => MessageFormatter.addHook(text => text, { order: Infinity })).toThrow(TypeError);
        expect(() => MessageFormatter.addHook(text => text, { stage: formatting_stage.AFTER_MARKDOWN })).not.toThrow();
    });

    it('uses default stage and order values', async () => {
        const { MessageFormatter, formatting_stage } = await importFreshFormatter();

        MessageFormatter.addHook(text => `${text}:default`);

        expect(MessageFormatter.runStage(formatting_stage.BEFORE_REGEX, 'text', baseContext())).toBe('text');
        expect(MessageFormatter.runStage(formatting_stage.AFTER_MARKDOWN, 'text', baseContext())).toBe('text:default');
    });

    it('returns original text unchanged for unknown stages', async () => {
        const { MessageFormatter } = await importFreshFormatter();

        expect(MessageFormatter.runStage('unknown', 'original', baseContext())).toBe('original');
    });

    it('runs hooks by order and preserves equal-order insertion order explicitly', async () => {
        const { MessageFormatter, formatting_stage, hook_order } = await importFreshFormatter();

        MessageFormatter.addHook(text => `${text}C`, { stage: formatting_stage.AFTER_REGEX, order: hook_order.NORMAL });
        MessageFormatter.addHook(text => `${text}A`, { stage: formatting_stage.AFTER_REGEX, order: hook_order.EARLY });
        MessageFormatter.addHook(text => `${text}B`, { stage: formatting_stage.AFTER_REGEX, order: hook_order.EARLY });

        expect(MessageFormatter.runStage(formatting_stage.AFTER_REGEX, '', baseContext())).toBe('ABC');
    });

    it('does not let hooks registered during a stage run affect the current stage pass', async () => {
        const { MessageFormatter, formatting_stage, hook_order } = await importFreshFormatter();

        MessageFormatter.addHook((text) => {
            MessageFormatter.addHook(value => `${value}B`, {
                stage: formatting_stage.AFTER_REGEX,
                order: hook_order.EARLY,
            });
            return `${text}A`;
        }, { stage: formatting_stage.AFTER_REGEX, order: hook_order.NORMAL });

        expect(MessageFormatter.runStage(formatting_stage.AFTER_REGEX, '', baseContext())).toBe('A');
        expect(MessageFormatter.runStage(formatting_stage.AFTER_REGEX, '', baseContext())).toBe('BA');
    });

    it('passes a frozen context with characterName and deprecated ch_name', async () => {
        const { MessageFormatter, formatting_stage } = await importFreshFormatter();
        let receivedContext;

        MessageFormatter.addHook((text, ctx) => {
            receivedContext = ctx;
            return text;
        }, { stage: formatting_stage.BEFORE_REGEX });

        MessageFormatter.runStage(formatting_stage.BEFORE_REGEX, 'text', baseContext());

        expect(Object.isFrozen(receivedContext)).toBe(true);
        expect(receivedContext.characterName).toBe('Alice');
        expect(receivedContext.ch_name).toBe('Alice');
        expect(receivedContext.stage).toBe(formatting_stage.BEFORE_REGEX);
    });

    it('continues after thrown hooks and ignores invalid return values', async () => {
        const { MessageFormatter, formatting_stage, hook_order } = await importFreshFormatter();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        MessageFormatter.addHook(() => {
            throw new Error('intentional');
        }, { stage: formatting_stage.AFTER_MARKDOWN, order: hook_order.EARLY });
        MessageFormatter.addHook(() => undefined, { stage: formatting_stage.AFTER_MARKDOWN, order: hook_order.NORMAL });
        MessageFormatter.addHook(() => ({ then: () => {} }), { stage: formatting_stage.AFTER_MARKDOWN, order: hook_order.LATE });
        MessageFormatter.addHook(text => `${text}:valid`, { stage: formatting_stage.AFTER_MARKDOWN, order: hook_order.LATEST });

        expect(MessageFormatter.runStage(formatting_stage.AFTER_MARKDOWN, 'text', baseContext())).toBe('text:valid');
        expect(console.error).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledTimes(2);
    });
});

function baseContext() {
    return {
        characterName: 'Alice',
        ch_name: 'Alice',
        isSystem: false,
        isUser: false,
        messageId: 1,
        isReasoning: false,
    };
}
