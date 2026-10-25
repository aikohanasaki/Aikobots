import { getRequestHeaders } from '../script.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from './popup.js';
import { t } from './i18n.js';
import { download } from './utils.js';
import { getUniverseDefaults, validateUniverseInfo } from './universe-info.js';

/** Opens the directory editor; failed saves preserve the form and its unsaved values. */
export async function showUniverseInfo(item, onSaved) {
    if (!item?.standaloneUniverse || !item.canEdit) return;
    const defaults = getUniverseDefaults(item.name, item.ownerHandles);
    const info = item.universeInfo || {};
    const form = document.createElement('form');
    form.className = 'universe-info-form';
    form.addEventListener('submit', event => event.preventDefault());
    const heading = document.createElement('h3');
    heading.textContent = t`Universe Info`;
    const notice = document.createElement('p');
    notice.textContent = t`This information appears in directory exports. Blank overrides use the automatic name and creator.`;
    form.append(heading, notice);
    const fields = [
        ['name', t`Universe Name`, 'text', defaults.name, 0],
        ['nameOverride', t`Name Override`, 'text', info.nameOverride, 200],
        ['creator', t`Creator`, 'text', defaults.creator, 0],
        ['creatorOverride', t`Creator Override`, 'text', info.creatorOverride, 200],
        ['description', t`Description`, 'textarea', info.description, 10000],
        ['audience', t`Who Is This Universe For?`, 'textarea', info.audience, 5000],
        ['tags', t`Tags (comma-separated)`, 'text', (info.tags || []).join(', '), 2458],
        ['imageUrl', t`Image URL`, 'url', info.imageUrl, 2048],
        ['informationUrl', t`More Information URL`, 'url', info.informationUrl, 2048],
    ];
    for (const [key, caption, type, value, limit] of fields) {
        const label = document.createElement('label');
        const text = document.createElement('span');
        text.textContent = caption;
        const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') input.type = type;
        else input.rows = 4;
        input.name = key;
        input.className = 'text_pole';
        input.value = value || '';
        input.readOnly = !limit;
        if (limit) input.maxLength = limit;
        label.append(text, input);
        form.append(label);
    }
    let saving = false;
    const popup = new Popup(form, POPUP_TYPE.CONFIRM, '', {
        okButton: t`Save`, cancelButton: t`Cancel`, wide: true, allowVerticalScrolling: true,
        onClosing: async instance => {
            if (saving) return false;
            if (instance.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            if (!form.reportValidity()) return false;
            let metadata;
            try {
                const values = Object.fromEntries(new FormData(form));
                metadata = validateUniverseInfo({ ...values, tags: String(values.tags).split(',').map(tag => tag.trim()).filter(Boolean) });
            } catch {
                toastr.error(t`Check the field lengths, use at most 30 tags of 80 characters, and use HTTPS URLs without credentials.`, t`Universe Info`);
                return false;
            }
            saving = true;
            instance.okButton.disabled = true;
            try {
                const response = await fetch('/api/worldinfo/universe-info', {
                    method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ name: item.name, info: metadata }),
                });
                if (!response.ok) throw new Error('Universe information save failed');
                onSaved(await response.json());
                return true;
            } catch {
                toastr.error(t`Could not save universe information. Check your editing permissions and checkout status, then try again.`, t`Universe Info`);
                return false;
            } finally {
                saving = false;
                instance.okButton.disabled = false;
            }
        },
    });
    await popup.show();
}

/** Downloads the admin-only directory metadata snapshot. */
export async function downloadUniverseDirectory() {
    try {
        const response = await fetch('/api/worldinfo/universe-directory', { method: 'POST', headers: getRequestHeaders() });
        if (!response.ok) throw new Error('Universe export failed');
        download(JSON.stringify(await response.json(), null, 2), 'universes.json', 'application/json');
    } catch {
        toastr.error(t`Could not export the universe directory.`, t`Universe Directory`);
    }
}
