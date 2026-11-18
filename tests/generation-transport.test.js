import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fetchGenerationResponse, generationResponseError, generationRetryDelay, retryGenerationTransport } from '../public/scripts/generation-transport.js';

afterEach(() => jest.useRealTimers());

describe('generation transport deadlines and retries', () => {
    it('preserves an access rejection even when its error body stalls', async () => {
        jest.useFakeTimers();
        const result = fetchGenerationResponse('/synthetic', {}, { fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
            start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); },
        }), { status: 403 }) });
        await jest.advanceTimersByTimeAsync(15_000);
        expect(generationResponseError(await result).retryable).toBe(false);
        expect((await result).status).toBe(403);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each(['headers', 'body'])('bounds a silent %s stall without cancelling the generation signal', async stage => {
        jest.useFakeTimers();
        const abort = new AbortController();
        let connectionSignal;
        const fetchImpl = (_url, { signal }) => {
            connectionSignal = signal;
            if (stage === 'headers') return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
            return Promise.resolve(new Response(new ReadableStream({ start(controller) {
                signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
            } })));
        };
        const result = fetchGenerationResponse('/synthetic', { signal: abort.signal }, { fetchImpl });
        const checked = expect(result).rejects.toMatchObject({ retryable: true, generationCancellationCode: 'START_TIMEOUT' });
        await jest.advanceTimersByTimeAsync(15_000);
        await checked;
        expect(connectionSignal.aborted).toBe(true);
        expect(abort.signal.aborted).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('exhausts the recovery budget instead of retrying forever', async () => {
        jest.useFakeTimers();
        const failure = Object.assign(new Error('synthetic'), { retryable: true, generationRecoveryAvailable: true });
        const operation = jest.fn().mockRejectedValue(failure);
        const result = retryGenerationTransport(operation);
        const checked = expect(result).rejects.toBe(failure);
        await jest.advanceTimersByTimeAsync(180_000);
        await checked;
        const attempts = operation.mock.calls.length;
        await jest.advanceTimersByTimeAsync(180_000);
        expect(operation).toHaveBeenCalledTimes(attempts);
        expect(attempts).toBeGreaterThan(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('honors Retry-After and stops during backoff without another attempt', async () => {
        jest.useFakeTimers();
        const abort = new AbortController();
        const operation = jest.fn().mockRejectedValue(generationResponseError(new Response(null, {
            status: 429, headers: { 'Retry-After': '30' },
        })));
        const result = retryGenerationTransport(operation, { signal: abort.signal });
        const checked = expect(result).rejects.toMatchObject({ name: 'AbortError' });
        await jest.advanceTimersByTimeAsync(29_000);
        expect(operation).toHaveBeenCalledTimes(1);
        abort.abort();
        await checked;
        await jest.advanceTimersByTimeAsync(60_000);
        expect(operation).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each([401, 403, 409])('does not retry HTTP %s', async status => {
        const operation = jest.fn().mockRejectedValue(generationResponseError(new Response(null, { status })));
        await expect(retryGenerationTransport(operation)).rejects.toMatchObject({ retryable: false });
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('does not fetch or leave a backoff timer when already stopped', async () => {
        jest.useFakeTimers();
        const abort = new AbortController();
        abort.abort();
        const fetchImpl = jest.fn();
        await expect(fetchGenerationResponse('/synthetic', { signal: abort.signal }, { fetchImpl })).rejects.toMatchObject({ name: 'AbortError' });
        await expect(generationRetryDelay(1000, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });
});
