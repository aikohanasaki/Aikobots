import { jest } from '@jest/globals';

const queryCollection = jest.fn();
const getConfigValue = jest.fn().mockReturnValue('configured-transformer-model');
jest.unstable_mockModule('../src/endpoints/vectors.js', () => ({ queryCollection }));
jest.unstable_mockModule('../src/util.js', () => ({ getConfigValue }));

const { setup } = await import('../public/scripts/extensions/vectors/server.js');

describe('server-side vector chat injection', () => {
    it('can inject a matching message when protect is zero', async () => {
        const oldMessage = { messageId: 1, name: 'Alice', mes: 'old memory' };
        const currentMessage = { messageId: 2, name: 'Bob', mes: 'current message' };
        queryCollection.mockResolvedValue({ hashes: [2150544247900130] });
        const setExtensionPrompt = jest.fn();
        let interceptor;

        setup({
            registerGenerationInterceptor(value) {
                interceptor = value;
            },
        });

        const promptContext = {
            coreChat: [oldMessage, currentMessage],
            extensionSettings: {},
        };
        await interceptor({
            settings: {
                enabled_chats: true,
                insert: 1,
                template: 'Past events:\n{{text}}',
            },
            type: 'normal',
            currentChatId: 'chat-id',
            chat: [oldMessage, currentMessage],
            directories: {},
            promptContext,
            removeExtensionPrompt: jest.fn(),
            setExtensionPrompt,
            substituteParams(value, additional = {}) {
                return String(value).replace('{{text}}', additional.text ?? '{{text}}');
            },
        });

        expect(queryCollection).toHaveBeenCalledTimes(1);
        expect(getConfigValue).toHaveBeenCalledWith('extensions.models.embedding', '');
        expect(queryCollection.mock.calls[0][3]).toEqual({ model: 'configured-transformer-model' });
        expect(promptContext.coreChat).toEqual([currentMessage]);
        expect(setExtensionPrompt).toHaveBeenCalledWith(
            '3_vectors',
            'Past events:\nAlice: old memory',
            expect.any(Number),
            expect.any(Number),
            false,
        );
    });
});
