import { describe, expect, it, jest } from '@jest/globals';

import { createSentencepieceEncodingHandler } from '../src/endpoints/tokenizers.js';

describe('sentencepiece encoding handler', () => {
    it('preserves the estimated count when chunk encoding fails after id encoding falls back', async () => {
        const tokenizer = {
            get: jest.fn(async () => ({
                encodeIds: () => {
                    throw new Error('bad input');
                },
                encodePieces: () => {
                    throw new Error('bad input');
                },
            })),
        };
        const request = { body: { text: 'abcdef' } };
        const response = {
            send: jest.fn(payload => payload),
            sendStatus: jest.fn(status => status),
        };
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const handler = createSentencepieceEncodingHandler(tokenizer);
            await handler(request, response);

            expect(response.send).toHaveBeenCalledWith({
                ids: [],
                count: 2,
                chunks: [],
            });
            expect(response.sendStatus).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        }
    });
});
