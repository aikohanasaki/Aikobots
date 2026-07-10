import { beforeAll, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../public/scripts/stmb-core.js', () => ({
    compiledSceneToText: scene => (scene?.messages || []).map(message => `${message.name}: ${message.mes}`).join('\n'),
    identifyManagedMemoryEntries: () => [],
}));

jest.unstable_mockModule('../../public/scripts/extensions.js', () => ({
    extension_settings: { STMemoryBooks: { moduleSettings: {} } },
}));

jest.unstable_mockModule('../../public/scripts/extensions/regex/engine.js', () => ({
    getRegexScripts: () => [],
    runRegexScript: (_script, text) => text,
}));

jest.unstable_mockModule('../../public/scripts/stmb-sideprompt-macros.js', () => ({
    applySidePromptMacros: text => String(text || ''),
}));

jest.unstable_mockModule('../../public/scripts/stmb-summary-prompt-manager.js', () => ({
    getRequiredSummaryPromptText: () => 'Fallback prompt.',
}));

let buildMemoryPromptText;

beforeAll(async () => {
    ({ buildMemoryPromptText } = await import('../../public/scripts/stmb-prompt-assembly.js'));
});

describe('STMB group prompt assembly', () => {
    it('selects snapshotted group prompts and substitutes the group macro', () => {
        const prompt = buildMemoryPromptText({
            metadata: {
                userName: 'User',
                characterName: 'Character',
                groupName: 'The Party',
                stmbPromptTarget: 'group',
            },
            messages: [{ name: 'User', mes: 'Hello' }],
        }, {
            useGroupSpecificPrompts: true,
            groupPromptText: 'Remember {{group}} with {{char}} and {{user}}.',
        }, { entries: {} });

        expect(prompt).toContain('Remember The Party with Character and User.');
    });
});
