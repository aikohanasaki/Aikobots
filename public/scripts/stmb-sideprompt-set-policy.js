/**
 * Select resolved rows for an automatic trigger.
 * A selected after-memory set runs every resolved member; individual mode and
 * interval evaluation still honor each template's automatic trigger settings.
 */
export function filterAutomaticSidePromptSetItems(items, trigger, { selectedSet = false } = {}) {
    const resolvedItems = Array.isArray(items) ? items : [];
    if (selectedSet && trigger === 'onAfterMemory') {
        return resolvedItems;
    }

    return resolvedItems.filter((item) => {
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
