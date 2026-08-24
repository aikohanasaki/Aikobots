import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const registeredCommands = [];
const doReturn = jest.fn(async (_type, value, { objectToStringFunc }) => objectToStringFunc(value));

jest.unstable_mockModule('../public/scripts/i18n.js', () => ({
    t: value => String(value),
    translate: value => String(value),
}));

jest.unstable_mockModule('../public/lib.js', () => ({
    DOMPurify: { sanitize: value => value },
}));

jest.unstable_mockModule('../public/script.js', () => ({
    addOneMessage: jest.fn(),
    chat: [],
    event_types: {},
    eventSource: { emit: jest.fn() },
    getGeneratingApi: jest.fn(),
    getGeneratingModel: jest.fn(),
    main_api: 'openai',
    saveChatConditional: jest.fn(),
    system_avatar: '',
    systemUserName: 'System',
}));

jest.unstable_mockModule('../public/scripts/openai.js', () => ({
    chat_completion_sources: {},
    custom_prompt_post_processing_types: {},
    getEffectivePromptPostProcessing: jest.fn(),
    model_list: [],
    oai_settings: {},
}));

jest.unstable_mockModule('../public/scripts/popup.js', () => ({
    Popup: { show: { text: jest.fn() } },
}));

jest.unstable_mockModule('../public/scripts/slash-commands/SlashCommand.js', () => ({
    SlashCommand: { fromProps: props => props },
}));

jest.unstable_mockModule('../public/scripts/slash-commands/SlashCommandArgument.js', () => ({
    ARGUMENT_TYPE: {
        BOOLEAN: 'boolean',
        CLOSURE: 'closure',
        DICTIONARY: 'dictionary',
        STRING: 'string',
    },
    SlashCommandArgument: { fromProps: props => props },
    SlashCommandNamedArgument: { fromProps: props => props },
}));

jest.unstable_mockModule('../public/scripts/slash-commands/SlashCommandClosure.js', () => ({
    SlashCommandClosure: class SlashCommandClosure {},
}));

jest.unstable_mockModule('../public/scripts/slash-commands/SlashCommandCommonEnumsProvider.js', () => ({
    enumIcons: { closure: 'closure' },
}));

jest.unstable_mockModule('../public/scripts/slash-commands/SlashCommandEnumValue.js', () => ({
    enumTypes: { enum: 'enum' },
    SlashCommandEnumValue: class SlashCommandEnumValue {},
}));

jest.unstable_mockModule('../public/scripts/slash-commands/SlashCommandParser.js', () => ({
    SlashCommandParser: {
        addCommandObject: command => registeredCommands.push(command),
        commands: {},
    },
}));

jest.unstable_mockModule('../public/scripts/slash-commands/SlashCommandReturnHelper.js', () => ({
    slashCommandReturnHelper: {
        doReturn,
        enumList: () => [],
    },
}));

jest.unstable_mockModule('../public/scripts/utils.js', () => ({
    isTrueBoolean: value => String(value).toLowerCase() === 'true',
}));

let ToolManager;
const toolNames = ['CloneableTool', 'FunctionSchema', 'ProxySchema'];

beforeAll(async () => {
    ({ ToolManager } = await import('../public/scripts/tool-calling.js'));
});

beforeEach(() => {
    registeredCommands.length = 0;
    doReturn.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    for (const name of toolNames) {
        ToolManager.unregisterFunctionTool(name);
    }
    jest.restoreAllMocks();
});

describe('function tool serialization', () => {
    it('emits a cloneable provider descriptor from an immutable schema snapshot', async () => {
        const parameters = {
            type: 'object',
            properties: {
                prompt: { type: 'string' },
            },
            required: ['prompt'],
        };

        ToolManager.registerFunctionTool({
            name: 'CloneableTool',
            displayName: 'Cloneable Tool',
            description: 'Clone-safe tool',
            parameters,
            action: async () => 'done',
            formatMessage: () => 'Working...',
            shouldRegister: () => true,
        });
        parameters.properties.prompt.type = 'number';

        const data = {};
        await ToolManager.registerFunctionToolsOpenAI(data);

        expect(() => structuredClone(data)).not.toThrow();
        expect(data.tools).toEqual([{
            type: 'function',
            function: {
                name: 'CloneableTool',
                description: 'Clone-safe tool',
                parameters: {
                    type: 'object',
                    properties: {
                        prompt: { type: 'string' },
                    },
                    required: ['prompt'],
                },
            },
        }]);
        expect(Object.hasOwn(data.tools[0], 'toString')).toBe(false);
    });

    it('rejects non-cloneable schemas without exposing their values', () => {
        const functionParameters = {
            type: 'object',
            properties: {
                hidden: () => 'function-schema-secret',
            },
        };
        const proxyParameters = new Proxy({
            type: 'object',
            marker: 'proxy-schema-secret',
        }, {});

        for (const [name, parameters, secret] of [
            ['FunctionSchema', functionParameters, 'function-schema-secret'],
            ['ProxySchema', proxyParameters, 'proxy-schema-secret'],
        ]) {
            let thrown;
            try {
                ToolManager.registerFunctionTool({
                    name,
                    description: 'Invalid tool',
                    parameters,
                    action: async () => '',
                });
            } catch (error) {
                thrown = error;
            }

            expect(thrown).toBeInstanceOf(TypeError);
            expect(thrown.message).toContain(`"${name}"`);
            expect(thrown.message).not.toContain(secret);
        }
    });

    it('preserves tools-list formatting without attaching behavior to request data', async () => {
        ToolManager.registerFunctionTool({
            name: 'CloneableTool',
            description: 'Clone-safe tool',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string' },
                },
            },
            action: async () => 'done',
        });
        ToolManager.initToolSlashCommands();
        const command = registeredCommands.find(item => item.name === 'tools-list');

        const output = await command.callback({ return: 'popup-html' });

        expect(output).toBe('<div><b>CloneableTool</b></div><div><small>Clone-safe tool</small></div><pre class="justifyLeft wordBreakAll"><code class="flex padding5">{\n  "type": "object",\n  "properties": {\n    "prompt": {\n      "type": "string"\n    }\n  }\n}</code></pre><hr>');
        expect(doReturn).toHaveBeenCalledTimes(1);
    });
});
