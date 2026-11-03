import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/scripts/stmb.js', import.meta.url), 'utf8');
const editorSource = source.slice(source.indexOf('function buildProfileEditorHtml('), source.indexOf('function buildProfileFromEditor('));
const { buildProfileEditorHtml, updateProfileEditorDynamicState } = vm.runInNewContext(
    editorSource + '; ({ buildProfileEditorHtml, updateProfileEditorDynamicState })', {
        stmbSettings: {},
        STMB_DEFAULT_TITLE_FORMAT: 'Memory',
        STMB_DEFAULT_TITLE_FORMATS: [],
        getProfilePresetKeys: () => [],
        getConnectionProfileOptionsHtml: () => '',
        escapeHtml: value => value,
    },
);

test('only unbound legacy direct profiles display the legacy warning', () => {
    for (const [profile, expected] of [
        [{ connection: { api: 'connection_profile' } }, false],
        [{ connection: { api: 'current_st' } }, false],
        [{ connection: { api: 'makersuite' } }, true],
        [{ connection: { api: 'makersuite' }, connectionProfileId: 'google-profile' }, false],
        [{ connection: { api: 'current_st' }, isBuiltinCurrentST: true }, false],
    ]) {
        assert.equal(buildProfileEditorHtml(profile).includes('id="stmb-profile-editor-legacy-warning"'), expected);
    }
});

test('selecting a connection hides the legacy warning and clearing it restores it', () => {
    let hidden;
    const selection = { value: '' };
    const warning = { classList: { toggle: (name, value) => {
        assert.equal(name, 'displayNone');
        hidden = value;
    } } };
    const dialog = { querySelector: selector => ({
        '#stmb-profile-editor-legacy-warning': warning,
        '#stmb-profile-editor-connection-profile': selection,
    })[selector] ?? null };
    for (const value of ['', 'google-profile', 'another-profile', '']) {
        selection.value = value;
        updateProfileEditorDynamicState(dialog);
        assert.equal(hidden, Boolean(value));
    }
    updateProfileEditorDynamicState({ querySelector: () => null });
});
