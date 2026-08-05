import { describe, expect, it, jest } from '@jest/globals';

import { createResumableGenerationResponse } from '../public/scripts/resumable-generation.js';

function sseResponse(text) {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
        },
    });
    return new Response(body, { status: 200 });
}

describe('resumable generation stream', () => {
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
});
