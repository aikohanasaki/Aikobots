/**
 * Limit resolved set rows to templates enabled for an automatic trigger.
 * Manual set runs intentionally do not use this filter.
 */
export function filterAutomaticSidePromptSetItems(items, trigger) {
    return (Array.isArray(items) ? items : []).filter((item) => {
        const template = item?.baseTemplate || item?.template;
        if (!template?.enabled) return false;

        if (trigger === 'onAfterMemory') {
            return Boolean(template.triggers?.onAfterMemory?.enabled);
        }
        if (trigger === 'onInterval') {
            const visibleMessages = Number(template.triggers?.onInterval?.visibleMessages);
            return Number.isFinite(visibleMessages) && visibleMessages >= 1;
        }
        return false;
    });
}
