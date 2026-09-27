import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let getImageSubscription;
let handleChatCompletionsGenerate;
let writeSecret;
let SECRET_KEYS;
const roots = [];

beforeAll(async () => {
    ({ getImageSubscription } = await import('../src/endpoints/novelai.js'));
    ({ handleChatCompletionsGenerate } = await import('../src/endpoints/backends/chat-completions.js'));
    ({ writeSecret, SECRET_KEYS } = await import('../src/endpoints/secrets.js'));
});

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        send(body) { this.body = body; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
        setHeader: jest.fn(),
    };
}

describe('chat-only backend boundaries', () => {
    it.each([
        { messages: 'Legacy string prompt' },
        { messages: [{ role: 'user', content: 'Hello' }], model: 'gpt-3.5-turbo-instruct' },
    ])('rejects legacy generation before reading credentials or dispatching a provider', async body => {
        const res = response();
        const request = { body, requestId: 'chat-only-test' };
        Object.defineProperty(request, 'user', { get() { throw new Error('Provider credentials must not be accessed'); } });
        await handleChatCompletionsGenerate(request, res);
        expect(res.statusCode).toBe(410);
    });
});

describe('NovelAI image subscription', () => {
    function request(withKey = true) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aikobots-image-subscription-'));
        roots.push(root);
        const directories = { root };
        if (withKey) writeSecret(directories, SECRET_KEYS.NOVEL, 'synthetic-test-key');
        return { user: { directories } };
    }

    it.each([
        [{ fixedTrainingStepsLeft: 42, purchasedTrainingSteps: 100 }, 142],
        [{ fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 100 }, 100],
        [{ fixedTrainingStepsLeft: 42 }, 42],
        [{ purchasedTrainingSteps: 100 }, 100],
        [undefined, 0],
    ])('uses the user secret and returns only the image UI fields for %j', async (trainingStepsLeft, balance) => {
        const fetchSubscription = jest.fn(async () => ({ ok: true, json: async () => ({
            trainingStepsLeft,
            perks: { unlimitedImageGeneration: true },
            unrelatedAccountField: 'omit',
        }) }));
        const res = response();
        await getImageSubscription(request(), res, fetchSubscription);
        expect(fetchSubscription).toHaveBeenCalledWith('https://image.novelai.net/user/subscription', expect.objectContaining({
            headers: { Authorization: 'Bearer synthetic-test-key' },
        }));
        expect(res.body).toEqual({ balance, unlimitedImageGeneration: true });
    });

    it('does not dispatch without credentials', async () => {
        const fetchSubscription = jest.fn();
        const res = response();
        await getImageSubscription(request(false), res, fetchSubscription);
        expect(res.statusCode).toBe(400);
        expect(fetchSubscription).not.toHaveBeenCalled();
    });

    it.each([401, 429, 500, 'network', 'json'])('returns a failure for upstream %s', async failure => {
        const fetchSubscription = async () => {
            if (failure === 'network') throw new Error('upstream detail');
            return { ok: failure === 'json', status: failure, json: async () => { throw new Error('invalid JSON'); } };
        };
        const res = response();
        await getImageSubscription(request(), res, fetchSubscription);
        expect(res.statusCode).toBe(failure === 401 ? 401 : 502);
        expect(res.body).toBeUndefined();
    });
});
