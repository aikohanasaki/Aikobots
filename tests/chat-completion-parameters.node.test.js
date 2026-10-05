import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { ADDITIONAL_PARAMETER_KEYS, getAdditionalParameters, setAdditionalParameters } from '../public/scripts/chat-completion-parameters.js';
import { applyAdditionalParameters } from '../src/endpoints/backends/chat-completion-parameters.js';
import { mergeConnectionProfilePayloadOverrides } from '../public/scripts/connection-profile-request-policy.js';
import { applyStmbProfileConnection } from '../public/scripts/stmb-core.js';
import { applyStmbRequestTransport } from '../public/scripts/stmb-request-transport.js';

const openaiSource = fs.readFileSync(new URL('../public/scripts/openai.js', import.meta.url), 'utf8');

/** Loads an existing browser function with only its browser dependencies stubbed. */
function browserFunction(source, start, end, name, context) {
    return vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))).replace(/^export /gm, '') + `\n${name}`, context);
}

test('provider parameters survive JSON round trips without inheriting legacy custom values', () => {
    const settings = { custom_include_body: 'legacy: true' };
    setAdditionalParameters(settings, 'openai', { custom_include_body: 'temperature: 0.3' });
    setAdditionalParameters(settings, 'claude', { custom_include_headers: 'anthropic-beta: example' });
    const restored = JSON.parse(JSON.stringify(settings));
    assert.equal(getAdditionalParameters(restored, 'custom').custom_include_body, 'legacy: true');
    assert.equal(getAdditionalParameters(restored, 'openai').custom_include_body, 'temperature: 0.3');
    assert.equal(getAdditionalParameters(restored, 'claude').custom_include_body, '');
    assert.equal(getAdditionalParameters(restored, 'makersuite').custom_include_headers, '');
    setAdditionalParameters(restored, 'openai', {});
    assert.equal(getAdditionalParameters(restored, 'claude').custom_include_headers, 'anthropic-beta: example');
    assert.equal(getAdditionalParameters(settings, 'openai').custom_include_body, 'temperature: 0.3');
});

test('applying connection profiles preserves absent parameters and restores explicitly saved values', async () => {
    const manager = fs.readFileSync(new URL('../public/scripts/extensions/connection-manager/index.js', import.meta.url), 'utf8');
    for (const source of ['azure', 'custom']) {
        const settings = { chat_completion_source: source };
        const parameters = Object.fromEntries(ADDITIONAL_PARAMETER_KEYS.map(key => [key, 'example: true']));
        setAdditionalParameters(settings, source, parameters);
        let saves = 0;
        const apply = browserFunction(manager, 'export async function applyConnectionProfile(', '\n/**', 'applyConnectionProfile', {
            ADDITIONAL_PARAMETER_KEYS, getAdditionalParameters, setAdditionalParameters, oai_settings: settings,
            ConnectionManagerSpinner: class { static abort() {} start() {} stop() {} },
            CC_COMMANDS: [], TC_COMMANDS: [], saveSettingsDebounced() { saves++; },
            waitForCurrentOpenAIConnection: async () => {}, online_status: 'connected',
        });
        const legacyOverrides = { azure_deployment_name: 'example' };
        if (source !== 'custom') Object.assign(legacyOverrides, { custom_include_body: 'custom_only: true' });
        await apply({ mode: 'cc', 'request-overrides': legacyOverrides });
        assert.deepEqual(getAdditionalParameters(settings, source), parameters);
        assert.equal(saves, 0);
        await apply({ mode: 'cc', 'request-overrides': { additional_parameters: { claude: {} } } });
        assert.deepEqual(getAdditionalParameters(settings, source), parameters);
        assert.equal(saves, 0);
        for (const body of ['', 'restored: true']) {
            const values = { custom_include_body: body };
            const overrides = source === 'custom' ? values : { additional_parameters: { [source]: values } };
            await apply({ mode: 'cc', 'request-overrides': overrides });
            assert.deepEqual(getAdditionalParameters(settings, source), {
                custom_include_body: body, custom_exclude_body: '', custom_include_headers: '',
            });
        }
        assert.equal(saves, 2);
    }
});

test('YAML overrides are shallow, exclusions win, and headers replace case-insensitively', () => {
    const result = applyAdditionalParameters({
        custom_include_body: '- temperature: 0.2\n- nested: {replacement: true}\n  removed: true',
        custom_exclude_body: '- removed\n- model',
        custom_include_headers: 'authorization: replacement\nX-Example: enabled',
    }, { body: { model: 'example', temperature: 1, nested: { original: true } }, headers: { Authorization: 'original' } });
    assert.deepEqual(JSON.parse(result.body), { temperature: 0.2, nested: { replacement: true } });
    assert.deepEqual(Object.fromEntries(result.headers), { authorization: 'replacement', 'x-example': 'enabled' });
});

test('empty and malformed YAML preserve existing requests; invalid headers do not echo values', () => {
    for (const value of ['', '[invalid']) {
        const result = applyAdditionalParameters({ custom_include_body: value, custom_exclude_body: value, custom_include_headers: value }, {
            body: { model: 'example', stream: true }, headers: { Authorization: 'example' },
        });
        assert.deepEqual(JSON.parse(result.body), { model: 'example', stream: true });
        assert.deepEqual(Object.fromEntries(result.headers), { authorization: 'example' });
    }
    assert.throws(() => applyAdditionalParameters({ custom_include_headers: 'X-Example: "invalid\\nvalue"' }, {
        body: {}, headers: {},
    }), { message: 'Invalid additional request header.' });
});

test('completion preset save/load preserves independent parameter maps without aliasing', async () => {
    const settings = { preset_settings_openai: 'Example' };
    setAdditionalParameters(settings, 'openai', { custom_include_body: 'example: true' });
    let saved;
    const context = {
        structuredClone, oai_settings: settings, openai_settings: [{}], openai_setting_names: { Example: 0 },
        getRequestHeaders: () => ({}),
        fetch: async (_url, options) => {
            saved = JSON.parse(options.body).preset;
            return { ok: true, json: async () => ({ name: 'Example' }) };
        },
        $: () => ({ prop() { return this; }, trigger() { return this; }, find: () => ({ text: () => 'Example' }) }),
        eventSource: { emit: async () => {} }, event_types: {}, saveSettingsDebounced() {},
        settingsToUpdate: { additional_parameters: ['', 'additional_parameters', false, true] },
    };
    context.saveOpenAIPreset = browserFunction(openaiSource, 'async function saveOpenAIPreset(', '\nfunction onLogitBiasPresetChange', 'saveOpenAIPreset', context);
    await context.saveOpenAIPreset('Example', settings, false);
    assert.deepEqual(saved.additional_parameters, settings.additional_parameters);
    const apply = browserFunction(openaiSource, 'function onSettingsPresetChange()', '\nfunction getMaxContextOpenAI', 'onSettingsPresetChange', context);
    context.openai_settings[0] = saved;
    setAdditionalParameters(settings, 'openai', {});
    await apply();
    assert.equal(getAdditionalParameters(settings, 'openai').custom_include_body, 'example: true');
    settings.additional_parameters.openai.custom_include_body = 'changed: true';
    assert.equal(saved.additional_parameters.openai.custom_include_body, 'example: true');
    context.openai_settings[0] = {};
    await apply();
    assert.equal(getAdditionalParameters(settings, 'openai').custom_include_body, 'changed: true');
    context.openai_settings[0] = { additional_parameters: {} };
    await apply();
    assert.equal(getAdditionalParameters(settings, 'openai').custom_include_body, '');
});

test('connection profile capture and request snapshots isolate background requests', async () => {
    const source = fs.readFileSync(new URL('../public/scripts/connection-profile-request.js', import.meta.url), 'utf8');
    const manager = fs.readFileSync(new URL('../public/scripts/extensions/connection-manager/index.js', import.meta.url), 'utf8');
    const keys = vm.runInNewContext(source.slice(source.indexOf('const REQUEST_OVERRIDE_KEYS'), source.indexOf('\nfunction getConnectionManagerSettings')) + '\nREQUEST_OVERRIDE_KEYS');
    const settings = { chat_completion_source: 'claude', custom_include_body: 'legacy: true' };
    const parameters = {
        custom_include_body: 'claude_option: true',
        custom_exclude_body: '- temperature',
        custom_include_headers: 'X-Example: enabled',
    };
    setAdditionalParameters(settings, 'claude', parameters);
    setAdditionalParameters(settings, 'openai', { custom_include_body: 'openai_option: true' });
    const capture = browserFunction(manager, 'function captureRequestOverrides(', '\n/**', 'captureRequestOverrides', {
        REQUEST_OVERRIDE_KEYS: keys, ADDITIONAL_PARAMETER_KEYS, getAdditionalParameters, oai_settings: settings, structuredClone,
    });
    const profile = {};
    capture(profile);
    assert.deepEqual(Object.keys(profile['request-overrides'].additional_parameters), ['claude']);
    assert.equal(profile['request-overrides'].custom_include_body, undefined);
    const copy = browserFunction(source, 'function copyRequestOverrides(', '\n/**', 'copyRequestOverrides', {
        REQUEST_OVERRIDE_KEYS: keys, getAdditionalParameters, structuredClone,
    });
    const requestOverrides = copy(profile, 'claude');
    const apply = browserFunction(source, 'export function applyConnectionProfileSnapshot(', '\n/**', 'applyConnectionProfileSnapshot', {
        structuredClone, resolveRequestModel: value => value, resolveConnectionProfileTemperature: value => value,
        proxies: [], mergeConnectionProfilePayloadOverrides,
    });
    const payload = apply({ custom_include_body: 'active_provider: true' }, { model: 'example', source: 'claude', requestOverrides });
    assert.equal(payload.custom_include_body, 'claude_option: true');
    assert.equal(payload.additional_parameters, undefined);
    profile['request-overrides'].additional_parameters.claude.custom_include_body = 'changed: true';
    assert.equal(requestOverrides.custom_include_body, 'claude_option: true');
    assert.equal(copy({ 'request-overrides': { custom_include_body: 'legacy: true' } }, 'openai').custom_include_body, '');
    assert.equal(copy({ 'request-overrides': { custom_include_body: 'legacy: true' } }, 'custom').custom_include_body, 'legacy: true');

    const apiSource = fs.readFileSync(new URL('../public/scripts/stmb-api.js', import.meta.url), 'utf8');
    let dispatched;
    const generate = browserFunction(apiSource, 'async function generateStmbProviderResponse(', '\nfunction getStmbStreamingChunkError', 'generateStmbProviderResponse', {
        applyStmbRequestTransport,
        getStmbProviderKey: () => 'example', STMB_RATE_LIMIT_RETRY_DELAYS_MS: [], waitForStmbProviderCooldown: async () => {},
        normalizeStmbClientError: error => error, isStmbRateLimitError: () => false,
        getRequestHeaders: () => ({}),
        fetch: async (url, options) => {
            assert.equal(url, '/api/backends/chat-completions/generate');
            dispatched = JSON.parse(options.body);
            return { ok: true, body: {}, text: async () => '{"choices":[{"message":{"content":"OK"}}]}' };
        },
        consumeChatCompletionStream: async () => ({ text: 'OK', state: {}, lastChunk: {} }),
        buildStmbStreamingResponse: text => ({ choices: [{ message: { content: text } }] }),
    });
    for (const streaming of [false, true]) {
        for (const configured of [false, true]) {
            const snapshot = {
                model: 'example', source: 'claude',
                requestOverrides: configured ? requestOverrides : copy({}, 'claude'),
            };
            const generateData = applyStmbProfileConnection({
                messages: [{ role: 'user', content: 'Summarize this example.' }],
                custom_include_body: 'active_provider: true',
                custom_include_headers: 'X-Active: must-not-carry-over',
                custom_exclude_body: '- max_tokens',
            }, { streaming, connectionSnapshot: snapshot }, { applyConnectionProfileSnapshot: apply });
            const result = await generate({ generateData });
            assert.equal(result.choices[0].message.content, 'OK');
            assert.equal(dispatched.stream, streaming);
            assert.equal(dispatched.chat_completion_source, 'claude');
            for (const key of ADDITIONAL_PARAMETER_KEYS) {
                assert.equal(dispatched[key], configured ? parameters[key] : '');
            }
        }
    }
});

test('preset export retains parameters only when sensitive connection settings are included', async () => {
    for (const [stripSensitive, includeConnection] of [[false, true], [true, true], [false, false]]) {
        let exported;
        class Popup {
            static show = { confirm: async () => stripSensitive ? 1 : 0 };
            async show() {}
        }
        const preset = { additional_parameters: { openai: { custom_include_headers: 'X-Example: enabled' } } };
        const context = {
            structuredClone, oai_settings: { preset_settings_openai: 'Example' }, openai_settings: [preset], openai_setting_names: { Example: 0 },
            sensitiveFields: ['additional_parameters'], settingsToUpdate: { additional_parameters: ['', 'additional_parameters', false, true] },
            Popup, POPUP_RESULT: { AFFIRMATIVE: 1, CANCELLED: 2 }, POPUP_TYPE: {}, DOMPurify: { sanitize: value => value },
            t: strings => strings.join(''), translate: value => value, $: value => value,
            renderTemplateAsync: async () => ({ find: () => ({ val: () => String(includeConnection) }) }),
            eventSource: { emit: async () => {} }, event_types: {}, download: value => { exported = JSON.parse(value); },
        };
        const run = browserFunction(openaiSource, 'async function onExportPresetClick()', '\nasync function onLogitBiasPresetImportFileChange', 'onExportPresetClick', context);
        await run();
        assert.equal(Boolean(exported.additional_parameters), !stripSensitive && includeConnection);
        assert.ok(preset.additional_parameters, 'Export must not mutate the saved preset');
    }
});

test('the shared dialog edits only the provider that opened it and includes the localized notice', async () => {
    const template = fs.readFileSync(new URL('../public/scripts/templates/customEndpointAdditionalParameters.html', import.meta.url), 'utf8');
    assert.match(template, /data-i18n="additional_parameters_notice"/);
    const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const button = html.match(/<[^>]+id="customize_additional_parameters"[^>]*>/)[0];
    assert.doesNotMatch(button, /data-source=/);
    for (const locale of ['de-de', 'fr-fr', 'ja-jp', 'pt-pt', 'ru-ru']) {
        const strings = JSON.parse(fs.readFileSync(new URL(`../public/locales/${locale}.json`, import.meta.url), 'utf8'));
        assert.ok(strings.additional_parameters_notice);
    }
    const settings = { chat_completion_source: 'openai' };
    const inputs = new Map();
    const dialog = { find(selector) {
        const input = { val(value) { if (value === undefined) return this.value; this.value = value; return this; }, on(_event, callback) { this.callback = callback; } };
        inputs.set(selector, input);
        return input;
    } };
    const open = browserFunction(openaiSource, 'async function onCustomizeParametersClick()', '\n/**', 'onCustomizeParametersClick', {
        ADDITIONAL_PARAMETER_KEYS, getAdditionalParameters, setAdditionalParameters, oai_settings: settings,
        renderTemplateAsync: async () => dialog, $: value => value, saveSettingsDebounced() {}, callGenericPopup: async () => {}, POPUP_TYPE: {},
    });
    await open();
    settings.chat_completion_source = 'claude';
    const input = inputs.get('#custom_include_body');
    input.val('example: true');
    input.callback.call(input);
    assert.equal(getAdditionalParameters(settings, 'openai').custom_include_body, 'example: true');
    assert.equal(getAdditionalParameters(settings, 'claude').custom_include_body, '');
});
