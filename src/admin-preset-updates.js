import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { withDirectoryLock } from './file-system-lock.js';
import { withSettingsPersonasLock } from './settings-lock.js';

const RELEASE_FILE = 'admin-aikobots-preset.json';
const STATE_FILE = 'admin-preset-update-state.json';
const NUMBER_FIELDS = 'temperature frequency_penalty presence_penalty top_p top_k top_a min_p repetition_penalty openai_max_context openai_max_tokens names_behavior seed n'.split(' ');
const BOOLEAN_FIELDS = 'max_context_unlocked wrap_in_quotes stream_openai claude_use_sysprompt use_makersuite_sysprompt squash_system_messages image_inlining video_inlining audio_inlining continue_prefill function_calling show_thoughts enable_web_search request_images'.split(' ');
const STRING_FIELDS = 'send_if_empty impersonation_prompt new_chat_prompt new_group_chat_prompt new_example_chat_prompt continue_nudge_prompt bias_preset_selected wi_format scenario_format personality_format group_nudge_prompt assistant_prefill assistant_impersonation inline_image_quality continue_postfix reasoning_effort verbosity'.split(' ');

function fail(status) {
    return Object.assign(new Error('Preset update could not be processed.'), { status });
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Copy only explicitly supported fields; never publish arbitrary nested metadata. */
function pickFields(source, fields) {
    if (!isObject(source)) throw fail(400);
    const result = {};
    for (const [type, names] of Object.entries(fields)) {
        for (const name of names) {
            if (!Object.hasOwn(source, name)) continue;
            if (typeof source[name] !== type || (type === 'number' && !Number.isFinite(source[name]))) throw fail(400);
            result[name] = source[name];
        }
    }
    return result;
}

/** Select shareable preset values without resolving macros or lorebook references. */
export function sanitizePublishedPreset(source) {
    const result = pickFields(source, { number: NUMBER_FIELDS, boolean: BOOLEAN_FIELDS, string: STRING_FIELDS });
    if (!Array.isArray(source.prompts) || !source.prompts.length || !Array.isArray(source.prompt_order)) throw fail(400);
    result.prompts = source.prompts.map(prompt => {
        const clean = pickFields(prompt, {
            string: ['identifier', 'name', 'role', 'content'],
            boolean: ['system_prompt', 'marker', 'forbid_overrides'],
            number: ['injection_position', 'injection_depth', 'injection_order'],
        });
        if (!clean.identifier) throw fail(400);
        if (prompt.position !== undefined) {
            if (typeof prompt.position !== 'string' && !Number.isFinite(prompt.position)) throw fail(400);
            clean.position = prompt.position;
        }
        if (prompt.injection_trigger !== undefined) {
            if (!Array.isArray(prompt.injection_trigger) || prompt.injection_trigger.some(x => typeof x !== 'string')) throw fail(400);
            clean.injection_trigger = [...prompt.injection_trigger];
        }
        return clean;
    });
    // Only the global prompt order is portable; character-specific identities are private.
    result.prompt_order = source.prompt_order.filter(order => order?.character_id === 100001).map(order => {
        if (!Array.isArray(order.order)) throw fail(400);
        return { character_id: 100001, order: order.order.map(entry => {
            const clean = pickFields(entry, { string: ['identifier'], boolean: ['enabled'] });
            if (!clean.identifier || typeof clean.enabled !== 'boolean') throw fail(400);
            return clean;
        }) };
    });
    if (result.prompt_order.length !== 1) throw fail(400);
    return result;
}

function readJson(filename, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filename, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        // Do not propagate JSON parsing errors, which can contain private file contents.
        throw fail(500);
    }
}

function writeJson(filename, value) {
    writeFileAtomicSync(filename, JSON.stringify(value, null, 4), 'utf8');
}

/** Read the latest offer without modifying settings or exposing the release payload. */
export function getPendingPresetUpdate(directories, dataRoot = globalThis.DATA_ROOT) {
    const release = readJson(path.join(dataRoot, RELEASE_FILE), null);
    const state = readJson(path.join(directories.root, STATE_FILE), {});
    return release && release.id !== state.handledReleaseId ? { id: release.id } : null;
}

/** Serialize publication and decisions across workers, always before the user settings lock. */
async function withReleaseLock(dataRoot, operation) {
    // One short global lock is sufficient for occasional pushes; shard if publication traffic grows.
    return withDirectoryLock({
        lockPath: path.join(dataRoot, `${RELEASE_FILE}.lock`),
        retryMs: 50, timeoutMs: 10_000, staleMs: 60_000, heartbeatMs: 15_000,
        timeoutMessage: 'Timed out waiting for preset update.',
    }, operation);
}

/** Publish the saved admin preset, or durably accept/skip a specific offered release. */
export async function processPresetUpdate(action, directories, body = {}, { dataRoot = globalThis.DATA_ROOT, assertAllowed = async () => {} } = {}) {
    return withReleaseLock(dataRoot, releaseLock => withSettingsPersonasLock(directories, async userLock => {
        await assertAllowed();
        const releasePath = path.join(dataRoot, RELEASE_FILE);
        const presetPath = path.join(directories.openAI_Settings, 'Aikobots.json');
        const statePath = path.join(directories.root, STATE_FILE);
        if (action === 'publish') {
            const source = readJson(presetPath, null);
            if (!source) throw fail(404);
            const release = { id: randomUUID(), preset: sanitizePublishedPreset(source) };
            await releaseLock.run(() => writeJson(releasePath, release));
            return { id: release.id };
        }
        if (!['accept', 'skip'].includes(action) || typeof body.id !== 'string' || (body.complete !== undefined && typeof body.complete !== 'boolean')) throw fail(400);
        const release = readJson(releasePath, null);
        if (!release || release.id !== body.id) throw fail(409);
        const state = readJson(statePath, {});
        if (state.handledReleaseId === release.id) return { handled: true };
        if (action === 'skip') {
            await userLock.run(() => writeJson(statePath, { handledReleaseId: release.id }));
            return { handled: true };
        }
        if (body.complete) {
            if (state.pendingReleaseId !== release.id) throw fail(409);
            await userLock.run(() => writeJson(statePath, { handledReleaseId: release.id }));
            return { handled: true };
        }
        const preset = sanitizePublishedPreset(release.preset);
        const created = state.pendingReleaseId === release.id && typeof state.pendingCreated === 'boolean'
            ? state.pendingCreated : !fs.existsSync(presetPath);
        // Record intent first. A failed preset write or interrupted browser remains retryable.
        await userLock.run(() => writeJson(statePath, { ...state, pendingReleaseId: release.id, pendingCreated: created }));
        await userLock.run(() => writeJson(presetPath, preset));
        return { id: release.id, preset, created };
    }));
}
