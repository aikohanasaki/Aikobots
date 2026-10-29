import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const RETENTION_MS = 23 * 60 * 60_000;

/** Opens shared, disposable continuation metadata; never stores prompt text or credentials. */
function withDatabase(root, action) {
    const directory = path.join(root, '_google-interactions');
    mkdirSync(directory, { recursive: true });
    const db = new Database(path.join(directory, 'state.sqlite'));
    try {
        db.pragma('busy_timeout = 10000');
        db.pragma('journal_mode = WAL');
        db.exec('CREATE TABLE IF NOT EXISTS continuations (scope TEXT PRIMARY KEY, interaction_id TEXT NOT NULL, hashes TEXT NOT NULL, expires INTEGER NOT NULL)');
        return action(db);
    } finally {
        db.close();
    }
}

/** Uses an exact prompt prefix, scoped to authenticated user, chat, endpoint and credentials. */
export function prepareGoogleConversation(body, { root, user, chat, endpoint, credential }) {
    // Text-only continuation is deliberately conservative; tool/multimodal histories need exact step replay first.
    const formats = Array.isArray(body.response_format) ? body.response_format : body.response_format ? [body.response_format] : [];
    if (!root || !user || !chat || !credential || body.tools?.length || formats.some(format => format.type !== 'text') || !Array.isArray(body.input)
        || !body.input.length || !body.input.every(step => ['user_input', 'model_output'].includes(step.type)
            && Array.isArray(step.content) && step.content.length === 1
            && step.content[0].type === 'text' && typeof step.content[0].text === 'string')) return null;
    const hash = value => createHmac('sha256', credential).update(JSON.stringify(value)).digest('hex');
    const input = body.input;
    const config = { ...body };
    // Sampling and service tier are interaction-scoped and are resent, including random seeds.
    for (const key of ['input', 'stream', 'store', 'generation_config', 'service_tier']) delete config[key];
    const scope = hash([user, chat, endpoint, config]);
    const hashes = input.map(hash);
    let previous;
    try {
        previous = withDatabase(root, db => db.prepare('SELECT * FROM continuations WHERE scope = ? AND expires > ?').get(scope, Date.now()));
        if (previous) {
            const prefix = JSON.parse(previous.hashes);
            if (prefix.length < hashes.length && prefix.every((value, index) => value === hashes[index])) {
                body.previous_interaction_id = previous.interaction_id;
                body.input = input.slice(prefix.length);
            }
        }
    } catch {
        return null; // Optional metadata failure must not prevent ordinary generation.
    }
    body.store = true;
    return {
        reset() {
            delete body.previous_interaction_id;
            body.input = input;
        },
        complete(interaction) {
            if (interaction?.status !== 'completed' || typeof interaction.id !== 'string'
                || !/^[A-Za-z0-9_\-.:]{1,512}$/.test(interaction.id)) return;
            const outputs = interaction.steps?.filter(step => step.type !== 'thought');
            if (outputs?.length !== 1 || outputs[0].type !== 'model_output'
                || outputs[0].content?.length !== 1 || outputs[0].content[0].type !== 'text'
                || typeof outputs[0].content[0].text !== 'string') return;
            const output = { type: 'model_output', content: [{ type: 'text', text: outputs[0].content[0].text }] };
            try {
                withDatabase(root, db => db.transaction(() => {
                    db.prepare('DELETE FROM continuations WHERE expires <= ?').run(Date.now());
                    db.prepare('INSERT OR REPLACE INTO continuations VALUES (?, ?, ?, ?)')
                        .run(scope, interaction.id, JSON.stringify([...hashes, hash(output)]), Date.now() + RETENTION_MS);
                }).immediate());
            } catch { /* Losing an optimization must not lose a completed answer. */ }
        },
    };
}
