const FLOATING_LOREBOOK_SOURCE_ICONS = Object.freeze({
    global: 'fa-globe',
    chat: 'fa-comment',
    persona: 'fa-face-smile',
    character: 'fa-id-card',
    background: 'fa-server',
});

/** Returns the icon and priority class for a visible floating lorebook source. */
export function getFloatingLorebookSourcePresentation(source, priority) {
    const iconClass = FLOATING_LOREBOOK_SOURCE_ICONS[source];
    if (!iconClass || !Number.isInteger(priority) || priority < 1 || priority > 5) {
        return null;
    }

    return {
        iconClass,
        priority,
        priorityClass: `wi-floating-book-group-source-priority-${priority}`,
    };
}
