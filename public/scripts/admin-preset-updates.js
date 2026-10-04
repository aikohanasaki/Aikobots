import { eventSource, event_types, getRequestHeaders, isActiveSessionLocked, saveSettings } from '../script.js';
import { oai_settings, onSettingsPresetChange, openai_settings, openai_setting_names, settingsToUpdate } from './openai.js';
import { lodash } from '../lib.js';
import { getPresetManager } from './preset-manager.js';
import { isAdmin } from './user.js';
import { Popup, POPUP_RESULT } from './popup.js';
import { t } from './i18n.js';

let pendingRelease = null;
let ready = false;
let offering = false;

/** Queue settings-read metadata; never interrupt startup or show overlapping offers. */
export function queueAdminPresetUpdate(release) {
    pendingRelease = release;
    if (ready) void offerUpdate();
}

async function requestUpdate(action, body = {}) {
    const response = await fetch(`/api/presets/admin-update/${action}`, {
        method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(body),
    });
    if (!response.ok) throw Object.assign(new Error('Preset update failed'), { status: response.status });
    return response.json();
}

/** Apply new or active Aikobots presets through the normal preset path. */
async function offerUpdate() {
    if (!pendingRelease || offering || isActiveSessionLocked) return;
    offering = true;
    const release = pendingRelease;
    try {
        const answer = await Popup.show.confirm(t`Aikobots preset update`, t`Update the Aikobots sampler and prompt settings? If you do not have this preset, it will be created and selected. Connection settings will stay unchanged.`, {
            okButton: t`Yes`, cancelButton: t`No`,
        });
        if (answer === POPUP_RESULT.NEGATIVE) {
            await requestUpdate('skip', { id: release.id });
        } else if (answer === POPUP_RESULT.AFFIRMATIVE) {
            const result = await requestUpdate('accept', { id: release.id });
            if (!result.handled) {
                const active = oai_settings.preset_settings_openai === 'Aikobots';
                getPresetManager('openai').updateList('Aikobots', result.preset, { select: false });
                if (result.created || active) {
                    $('#settings_preset_openai').val(openai_setting_names.Aikobots);
                    await onSettingsPresetChange();
                    if (await saveSettings() !== true) throw new Error('Preset settings were not saved');
                }
                await requestUpdate('accept', { id: release.id, complete: true });
            }
        } else {
            return;
        }
        if (pendingRelease?.id === release.id) pendingRelease = null;
    } catch (error) {
        toastr.error(t`The preset update could not be completed. Please reload to try again.`);
        if (error.status === 409 && !isActiveSessionLocked) {
            const data = await fetch('/api/settings/get', {
                method: 'POST', headers: getRequestHeaders(), body: '{}',
            }).then(response => response.ok ? response.json() : null).catch(() => null);
            if (data) pendingRelease = data.adminPresetUpdate;
        }
    } finally {
        offering = false;
        if (pendingRelease && pendingRelease.id !== release.id) void offerUpdate();
    }
}

/** Bind the admin action and defer offers until application initialization is complete. */
export function initAdminPresetUpdates() {
    const button = document.getElementById('push_aikobots_preset');
    eventSource.on(event_types.APP_READY, () => {
        ready = true;
        button.classList.toggle('displayNone', !isAdmin());
        void offerUpdate();
    });
    button.addEventListener('click', async () => {
        const saved = openai_settings[openai_setting_names.Aikobots];
        const unsaved = oai_settings.preset_settings_openai === 'Aikobots' && saved
            && Object.entries(settingsToUpdate).some(([key, [, setting, , connection]]) =>
                !connection && key !== 'extensions' && !lodash.isEqual(saved[key], oai_settings[setting]));
        if (unsaved) {
            toastr.info(t`Save your Aikobots preset before pushing its update.`);
            return;
        }
        const answer = await Popup.show.confirm(t`Push Aikobots preset update`, t`Publish your saved Aikobots preset to all users? Save any preset edits before pushing. Connection settings and credentials are excluded.`);
        if (answer !== POPUP_RESULT.AFFIRMATIVE) return;
        button.disabled = true;
        try {
            await requestUpdate('publish');
            toastr.success(t`Aikobots preset update published.`);
        } catch {
            toastr.error(t`The preset update could not be completed. Please reload to try again.`);
        } finally {
            button.disabled = false;
        }
    });
}
