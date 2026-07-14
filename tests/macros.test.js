import { beforeAll, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../public/lib.js', () => {
    function moment() {
        return {
            diff: () => 0,
            format: () => '',
            utc: function () { return this; },
            utcOffset: function () { return this; },
        };
    }

    moment.duration = () => ({
        humanize: () => '',
    });

    return {
        Handlebars: {
            registerHelper: jest.fn(),
        },
        moment,
        seedrandom: () => () => 0,
        droll: {
            validate: () => false,
            roll: () => false,
        },
    };
});

jest.unstable_mockModule('../public/script.js', () => ({
    chat: [],
    chat_metadata: {},
    main_api: '',
    getMaxContextSize: () => 0,
    getCurrentChatId: () => 'test-chat',
    substituteParams: value => value,
    eventSource: {
        on: jest.fn(),
    },
    event_types: {},
    extension_prompts: {},
}));

jest.unstable_mockModule('../public/scripts/utils.js', () => ({
    timestampToMoment: () => ({ diff: () => 0 }),
    isDigitsOnly: value => /^\d+$/.test(value),
    getStringHash: value => String(value).length,
    escapeRegex: value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    uuidv4: () => 'test-nonce',
}));

jest.unstable_mockModule('../public/scripts/variables.js', () => ({
    getVariableMacros: () => [],
}));

jest.unstable_mockModule('../public/scripts/RossAscends-mods.js', () => ({
    isMobile: () => false,
}));

jest.unstable_mockModule('../public/scripts/constants.js', () => ({
    inject_ids: {
        CUSTOM_WI_OUTLET: key => `custom-wi-outlet-${key}`,
    },
}));

let evaluateMacros;

beforeAll(async () => {
    ({ evaluateMacros } = await import('../public/scripts/macros.js'));
});

describe('evaluateMacros', () => {
    it('strips deprecated banned macros independently', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        expect(evaluateMacros('keep {{banned "one"}} middle {{banned "two"}} tail', {}))
            .toBe('keep  middle  tail');
        expect(warnSpy).toHaveBeenCalledTimes(1);

        warnSpy.mockRestore();
    });
});
