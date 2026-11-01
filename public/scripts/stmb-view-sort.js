import { translate } from './i18n.js';
import { createViewSort } from './stmb-view-sort-policy.js';

const dialogSorts = new WeakMap();

/** Keep each prompt table's view order for its dialog session. */
export function getPromptTableSort(dialog, name, existing = null) {
    let sorts = dialogSorts.get(dialog);
    if (!sorts) {
        sorts = new Map();
        dialogSorts.set(dialog, sorts);
    }
    if (existing) sorts.set(name, existing);
    if (!sorts.has(name)) sorts.set(name, createViewSort());
    return sorts.get(name);
}

/** Mount accessible sorting on a rendered prompt table. */
export function mountPromptTableSort(table, state, fields, values) {
    if (!table?.tBodies[0]) return;
    const body = table.tBodies[0];
    const original = Array.from(body.rows);
    const headings = Array.from(table.querySelectorAll('thead th')).map(heading => {
        const key = heading.getAttribute('data-i18n');
        return {
            heading,
            key,
            label: key && !key.startsWith('[') ? translate(heading.textContent.trim(), key) : heading.textContent.trim(),
        };
    });
    const status = field => state.field === field
        ? translate(state.direction === 1 ? 'ascending' : 'descending', state.direction === 1 ? 'STMemoryBooks_SortAscending' : 'STMemoryBooks_SortDescending')
        : translate('unsorted', 'STMemoryBooks_SortUnsorted');
    const render = () => {
        body.append(...state.order(original, values));
        headings.forEach(({ heading, key, label }, index) => {
            const field = fields[index];
            if (!field) return;
            // Attribute-only i18n keeps the locale observer from replacing the button.
            if (key && !key.startsWith('[')) heading.setAttribute('data-i18n', `[aria-label]${key}`);
            let button = heading.querySelector('.stmb-sort-button');
            if (!button) {
                heading.textContent = '';
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'stmb-sort-button';
                heading.append(button);
            }
            button.textContent = `${label} ${state.field === field ? (state.direction === 1 ? '↑' : '↓') : '↕'}`;
            button.setAttribute('aria-label', `${label}: ${status(field)}`);
            heading.setAttribute('aria-sort', state.field === field ? (state.direction === 1 ? 'ascending' : 'descending') : 'none');
            button.onclick = () => { state.cycle(field); render(); };
        });
    };
    render();
}
