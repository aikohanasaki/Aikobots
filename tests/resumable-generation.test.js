import { describe, expect, it, jest } from '@jest/globals';

import { createResumableGenerationResponse } from '../public/scripts/resumable-generation.js';

function sseResponse(text, headers = undefined) {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
        },
    });
    return new Response(body, { status: 200, headers });
}

describe('resumable generation stream', () => {
    it('resumes after the last complete event when a partial SSE block stalls', async () => {
        jest.useFakeTimers();
        const abort = new AbortController();
        const fetchImpl = jest.fn().mockImplementationOnce((_url, { signal }) => Promise.resolve(new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('id: 1\ndata: {"delta":"first"}\n\nid: 2\ndata: {"delta":'));
                signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
            },
        })))).mockResolvedValueOnce(sseResponse('id: 2\ndata: [DONE]\n\n'));
        const result = createResumableGenerationResponse({
            url: '/generation/stream', requestId: 'synthetic', signal: abort.signal, getHeaders: () => ({}), fetchImpl,
        }).text();
        try {
            await jest.advanceTimersByTimeAsync(46_000);
            expect(await result).toBe('id: 1\ndata: {"delta":"first"}\n\nid: 2\ndata: [DONE]\n\n');
            expect(fetchImpl.mock.calls[1][1].headers['Last-Event-ID']).toBe('1');
            expect(abort.signal.aborted).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        } finally { abort.abort(); jest.useRealTimers(); }
    });

    it('allows preparation longer than the retry budget when job status confirms it is running', async () => {
        jest.useFakeTimers();
        const abort = new AbortController();
        let attempts = 0;
        const fetchImpl = jest.fn((_url, { signal }) => ++attempts > 13
            ? Promise.resolve(sseResponse('data: [DONE]\n\n'))
            : new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
        const checkStatus = jest.fn().mockResolvedValue({ state: 'running' });
        const result = createResumableGenerationResponse({
            url: '/generation/stream', requestId: 'synthetic', signal: abort.signal, getHeaders: () => ({}), fetchImpl, checkStatus,
        }).text();
        try {
            await jest.advanceTimersByTimeAsync(220_000);
            expect(await result).toContain('[DONE]');
            expect(checkStatus).toHaveBeenCalledTimes(13);
            expect(abort.signal.aborted).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        } finally { abort.abort(); jest.useRealTimers(); }
    });

    it('parks an unreachable stream after three minutes and stops reconnecting', async () => {
        jest.useFakeTimers();
        const abort = new AbortController();
        const fetchImpl = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        const result = createResumableGenerationResponse({
            url: '/generation/stream', requestId: 'synthetic', signal: abort.signal, getHeaders: () => ({}), fetchImpl,
        }).text();
        const checked = expect(result).rejects.toMatchObject({ generationRecoveryAvailable: true });
        try {
            await jest.advanceTimersByTimeAsync(180_001);
            await checked;
            const attempts = fetchImpl.mock.calls.length;
            await jest.advanceTimersByTimeAsync(180_000);
            expect(fetchImpl).toHaveBeenCalledTimes(attempts);
            expect(abort.signal.aborted).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        } finally { abort.abort(); jest.useRealTimers(); }
    });

    it.each(['headers', 'body'])('reconnects the same stream when %s silently stall', async stage => {
        jest.useFakeTimers();
        const abort = new AbortController();
        let bodyController;
        let connectionSignal;
        let requests = 0;
        const fetchImpl = jest.fn((_url, { signal }) => {
            if (++requests > 1) return Promise.resolve(sseResponse('id: 1\ndata: [DONE]\n\n'));
            connectionSignal = signal;
            if (stage === 'headers') {
                return new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
                });
            }
            return Promise.resolve(new Response(new ReadableStream({
                start(controller) {
                    bodyController = controller;
                    signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
                },
            })));
        });
        const onClose = jest.fn();
        const response = createResumableGenerationResponse({
            url: '/generation/stream', requestId: 'synthetic-stall', signal: abort.signal,
            getHeaders: () => ({}), fetchImpl, onClose,
        });
        let settled = false;
        const result = response.text().then(
            value => { settled = true; return value; },
            error => { settled = true; return error; },
        );
        try {
            await jest.advanceTimersByTimeAsync(120_000);
            expect(fetchImpl).toHaveBeenCalledTimes(2);
            if (stage === 'body') expect(bodyController).toBeDefined();
            expect(settled).toBe(true);
            expect(await result).toContain('[DONE]');
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(connectionSignal.aborted).toBe(true);
            expect(abort.signal.aborted).toBe(false);
        } finally {
            abort.abort();
            await result;
            jest.useRealTimers();
        }
        expect(connectionSignal.aborted).toBe(true);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps a slow response with heartbeats alive until answer and completion arrive', async () => {
        jest.useFakeTimers();
        const abort = new AbortController();
        const encoder = new TextEncoder();
        let bodyController;
        const fetchImpl = jest.fn((_url, { signal }) => Promise.resolve(new Response(new ReadableStream({
            start(controller) {
                bodyController = controller;
                signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
            },
        }))));
        const response = createResumableGenerationResponse({
            url: '/generation/stream', requestId: 'synthetic-slow', signal: abort.signal,
            getHeaders: () => ({}), fetchImpl,
        });
        let settled = false;
        const result = response.text().then(
            value => { settled = true; return value; },
            error => { settled = true; return error; },
        );
        try {
            for (let i = 0; i < 8; i++) {
                await jest.advanceTimersByTimeAsync(15_000);
                bodyController.enqueue(encoder.encode(': heartbeat\n\n'));
                await jest.advanceTimersByTimeAsync(0);
                expect(settled).toBe(false);
            }
            bodyController.enqueue(encoder.encode('id: 1\ndata: {"delta":"synthetic answer"}\n\nid: 2\ndata: [DONE]\n\n'));
            expect(await result).toBe(': heartbeat\n\n'.repeat(8)
                + 'id: 1\ndata: {"delta":"synthetic answer"}\n\nid: 2\ndata: [DONE]\n\n');
            expect(fetchImpl).toHaveBeenCalledTimes(1);
            expect(abort.signal.aborted).toBe(false);
        } finally {
            abort.abort();
            await result;
            jest.useRealTimers();
        }
    });

    it.each([408, 425, 429, 503])('resumes a delivery HTTP %s without failing the provider job', async status => {
        const signal = new AbortController().signal;
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(sseResponse('id: 1\ndata: {"delta":"partial"}\n\n'))
            .mockResolvedValueOnce(new Response('', { status }))
            .mockResolvedValueOnce(sseResponse('id: 2\ndata: [DONE]\n\n'));
        const response = createResumableGenerationResponse({
            url: '/generation/stream', requestId: 'synthetic', signal,
            getHeaders: () => ({}), fetchImpl, reconnectDelayMs: 0,
        });
        await expect(response.text()).resolves.toContain('[DONE]');
        expect(fetchImpl.mock.calls[2][1].headers['Last-Event-ID']).toBe('1');
        expect(signal.aborted).toBe(false);
    });

    it.each([401, 403, 404])('preserves recovery on delivery HTTP %s without repeatedly retrying access', async status => {
        const signal = new AbortController().signal;
        const fetchImpl = jest.fn().mockResolvedValue(new Response('', { status }));
        const response = createResumableGenerationResponse({
            url: '/generation/stream', requestId: 'synthetic', signal,
            getHeaders: () => ({}), fetchImpl, reconnectDelayMs: 0,
        });
        await expect(response.text()).rejects.toMatchObject({ generationRecoveryAvailable: true });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(signal.aborted).toBe(false);
    });

    it('preserves custom SSE events and resumes after the last durable event ID', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(sseResponse('id: 1\nevent: provider-delta\ndata: {"delta":"a"}\n\n'))
            .mockResolvedValueOnce(sseResponse('id: 2\ndata: [DONE]\n\n'));

        const response = createResumableGenerationResponse({
            url: '/generation/stream',
            requestId: 'request-1',
            signal: new AbortController().signal,
            getHeaders: () => ({ Authorization: 'test' }),
            fetchImpl,
            reconnectDelayMs: 0,
        });

        await expect(response.text()).resolves.toBe(
            'id: 1\nevent: provider-delta\ndata: {"delta":"a"}\n\nid: 2\ndata: [DONE]\n\n',
        );
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(fetchImpl.mock.calls[1][1].headers['Last-Event-ID']).toBe('1');
    });

    it('terminates after repeated empty reconnects without a DONE event', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(sseResponse(''));
        const response = createResumableGenerationResponse({
            url: '/generation/stream',
            requestId: 'request-2',
            signal: new AbortController().signal,
            getHeaders: () => ({}),
            fetchImpl,
            reconnectDelayMs: 0,
            maxEmptyReconnects: 3,
        });

        await expect(response.text()).rejects.toMatchObject({
            message: expect.stringContaining('without a terminal event'),
            generationRecoveryAvailable: true,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('forwards assembly metadata from the first successful connection', async () => {
        const onHeaders = jest.fn();
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(sseResponse('data: {"delta":"a"}\n\n', {
                'X-ST-Messages-Count': '12',
                'X-ST-First-Included-Message-Id': '34',
                'X-Secret-Sentinel': 'not-safe-to-forward',
            }))
            .mockResolvedValueOnce(sseResponse('data: [DONE]\n\n', {
                'X-ST-Messages-Count': '99',
                'X-ST-First-Included-Message-Id': '98',
            }));
        const response = createResumableGenerationResponse({
            url: '/generation/stream',
            requestId: 'request-metadata',
            signal: new AbortController().signal,
            getHeaders: () => ({}),
            onHeaders,
            fetchImpl,
            reconnectDelayMs: 0,
        });

        await expect(response.text()).resolves.toBe('data: {"delta":"a"}\n\ndata: [DONE]\n\n');
        expect(response.headers.get('X-ST-Messages-Count')).toBe('12');
        expect(response.headers.get('X-ST-First-Included-Message-Id')).toBe('34');
        expect(response.headers.get('X-Secret-Sentinel')).toBeNull();
        expect(onHeaders).toHaveBeenCalledTimes(1);
    });

    it('terminates after repeated retryable fetch failures', async () => {
        const fetchImpl = jest.fn().mockRejectedValue(new TypeError('network unavailable'));
        const response = createResumableGenerationResponse({
            url: '/generation/stream',
            requestId: 'request-3',
            signal: new AbortController().signal,
            getHeaders: () => ({}),
            fetchImpl,
            reconnectDelayMs: 0,
            maxEmptyReconnects: 2,
        });

        await expect(response.text()).rejects.toMatchObject({
            message: expect.stringContaining('without a terminal event'),
            generationRecoveryAvailable: true,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
