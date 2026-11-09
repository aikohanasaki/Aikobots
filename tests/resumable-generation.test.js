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
