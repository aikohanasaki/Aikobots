/**
 * Pipeline stages at which extension hooks may run.
 * All stages occur before DOMPurify sanitization so output is always sanitized.
 *
 * - `BEFORE_REGEX` - Raw message text, after prompt-bias stripping but before
 *                    custom regex rules are applied.
 * - `AFTER_REGEX` - After custom regex rules, before Markdown conversion.
 *                   The text is still plain Markdown at this point.
 * - `AFTER_MARKDOWN` - After Markdown-to-HTML conversion, before
 *                      `allow_name2_display` stripping and sanitization.
 *                      Hooks may see name prefixes that are removed later.
 *
 * There is intentionally no post-sanitize stage.
 *
 * @enum {string}
 */
export const formatting_stage = {
    BEFORE_REGEX: 'beforeRegex',
    AFTER_REGEX: 'afterRegex',
    AFTER_MARKDOWN: 'afterMarkdown',
};

/**
 * @typedef {formatting_stage[keyof formatting_stage]} MessageFormattingStage
 */

/**
 * Ordering buckets for formatting hooks.
 *
 * @enum {number}
 */
export const hook_order = {
    EARLIEST: 0,
    EARLY: 10,
    NORMAL: 50,
    LATE: 90,
    LATEST: 100,
};

/**
 * Message metadata supplied to {@link MessageFormatterImpl#runStage}.
 *
 * @typedef {object} MessageFormattingBase
 * @property {string} characterName Character name associated with the message.
 * @property {string} [ch_name] Deprecated compatibility alias for `characterName`.
 * @property {boolean} isSystem Whether the message is a system message.
 * @property {boolean} isUser Whether the message was sent by the user.
 * @property {number} messageId Index of the message in the chat array, or -1 for transient messages.
 * @property {boolean} isReasoning Whether the message is reasoning/thinking output.
 */

/**
 * Immutable context object passed to every formatting hook.
 *
 * @typedef {Readonly<MessageFormattingBase & { ch_name: string, stage: MessageFormattingStage }>} MessageFormattingContext
 */

/**
 * A formatting hook function.
 * Must return the transformed message text synchronously as a string.
 *
 * @callback MessageFormattingHook
 * @param {string} text Current message text at this pipeline stage.
 * @param {MessageFormattingContext} ctx Immutable metadata about the message.
 * @returns {string} The transformed message text.
 */

/**
 * Options accepted by {@link MessageFormatterImpl#addHook}.
 *
 * @typedef {object} AddHookOptions
 * @property {MessageFormattingStage} [stage=formatting_stage.AFTER_MARKDOWN] Pipeline stage.
 * @property {number} [order=hook_order.NORMAL] Numeric priority. Lower numbers run first.
 */

function isPromiseLike(value) {
    return value !== null
        && (typeof value === 'object' || typeof value === 'function')
        && typeof value.then === 'function';
}

class MessageFormatterImpl {
    /** @type {Map<MessageFormattingStage, { fn: MessageFormattingHook, order: number, sequence: number }[]>} */
    #hooks = new Map();

    /** @type {number} */
    #sequence = 0;

    /** @type {typeof formatting_stage} */
    stage = formatting_stage;

    /** @type {typeof hook_order} */
    order = hook_order;

    constructor() {
        this.#hooks.set(formatting_stage.BEFORE_REGEX, []);
        this.#hooks.set(formatting_stage.AFTER_REGEX, []);
        this.#hooks.set(formatting_stage.AFTER_MARKDOWN, []);
    }

    /**
     * Registers a hook function to run at a specific pipeline stage.
     *
     * @param {MessageFormattingHook} fn Hook function.
     * @param {AddHookOptions} [options={}] Options object.
     * @returns {void}
     */
    addHook(fn, { stage = formatting_stage.AFTER_MARKDOWN, order = hook_order.NORMAL } = {}) {
        if (typeof fn !== 'function') {
            throw new TypeError('MessageFormatter: hook must be a function');
        }

        if (fn.constructor?.name === 'AsyncFunction') {
            throw new TypeError(`MessageFormatter: hook registered for stage '${stage}' must be synchronous; async functions are not supported`);
        }

        if (!this.#hooks.has(stage)) {
            throw new RangeError(`MessageFormatter: unknown stage '${stage}'`);
        }

        if (!Number.isFinite(order)) {
            throw new TypeError('MessageFormatter: hook order must be a finite number');
        }

        const bucket = this.#hooks.get(stage);
        bucket.push({ fn, order, sequence: this.#sequence++ });
        bucket.sort((a, b) => a.order - b.order || a.sequence - b.sequence);
    }

    /**
     * Runs all hooks registered for the given stage in order.
     *
     * @param {MessageFormattingStage} stage Pipeline stage to execute.
     * @param {string} text Current message text.
     * @param {MessageFormattingBase} baseContext Message metadata.
     * @returns {string} The message text after hooks have run.
     */
    runStage(stage, text, baseContext) {
        const bucket = this.#hooks.get(stage);
        if (!bucket?.length) {
            return text;
        }

        const characterName = baseContext.characterName ?? baseContext.ch_name ?? '';
        const ch_name = baseContext.ch_name ?? characterName;
        const ctx = Object.freeze({
            characterName,
            ch_name,
            isSystem: Boolean(baseContext.isSystem),
            isUser: Boolean(baseContext.isUser),
            messageId: baseContext.messageId ?? -1,
            isReasoning: Boolean(baseContext.isReasoning),
            stage,
        });

        const hooks = bucket.slice();
        for (const { fn } of hooks) {
            try {
                const result = fn(text, ctx);
                if (isPromiseLike(result)) {
                    console.warn(`[MessageFormatter] Hook at stage '${stage}' returned a Promise-like value instead of a string. The hook's return value has been ignored.`);
                } else if (typeof result !== 'string') {
                    console.warn(`[MessageFormatter] Hook at stage '${stage}' returned ${typeof result} instead of a string. The hook's return value has been ignored.`);
                } else {
                    text = result;
                }
            } catch (error) {
                console.error(`[MessageFormatter] Hook error at stage '${stage}':`, error);
            }
        }

        return text;
    }
}

/** @type {MessageFormatterImpl} */
export const MessageFormatter = new MessageFormatterImpl();
