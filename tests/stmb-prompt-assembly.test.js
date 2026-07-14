import { beforeAll, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../public/scripts/stmb-core.js', () => ({
    compiledSceneToText: scene => (scene?.messages || []).map(message => `${message.name}: ${message.mes}`).join('\n'),
    identifyManagedMemoryEntries: entries => Object.values(entries || {}).map(entry => ({
        comment: entry.comment,
        content: entry.content,
        key: entry.key || [],
    })),
}));

jest.unstable_mockModule('../public/scripts/extensions.js', () => ({
    extension_settings: { STMemoryBooks: { moduleSettings: {} } },
}));

jest.unstable_mockModule('../public/scripts/extensions/regex/engine.js', () => ({
    getRegexScripts: () => [],
    runRegexScript: (_script, text) => text,
}));

jest.unstable_mockModule('../public/scripts/stmb-sideprompt-macros.js', () => ({
    applySidePromptMacros: text => String(text || ''),
}));

jest.unstable_mockModule('../public/scripts/stmb-summary-prompt-manager.js', () => ({
    getRequiredSummaryPromptText: () => 'Create a memory for {{char}} and {{user}}.',
}));

let buildMemoryPromptText;
let buildSidePromptText;

beforeAll(async () => {
    ({ buildMemoryPromptText, buildSidePromptText } = await import('../public/scripts/stmb-prompt-assembly.js'));
});

describe('STMB prompt additional context assembly', () => {
    const compiledScene = {
        metadata: { userName: 'User', characterName: 'Character' },
        messages: [{ name: 'User', mes: 'Hello' }],
    };
    const contextEntries = [{
        title: 'Town Notes',
        content: 'The town is called Brightfall.',
        lorebookName: 'Lore',
        uid: '7',
    }];

    it('leaves memory prompts unchanged when no additional context is selected', () => {
        const prompt = buildMemoryPromptText(compiledScene, { promptText: 'Prompt' }, { entries: {} }, {
            moduleSettings: { defaultMemoryCount: 0 },
        });

        expect(prompt).not.toContain('=== ADDITIONAL CONTEXT FOR REFERENCE ===');
        expect(prompt).toContain('=== SCENE TRANSCRIPT ===');
    });

    it('injects memory additional context before previous memories and scene transcript', () => {
        const prompt = buildMemoryPromptText(compiledScene, { promptText: 'Prompt' }, {
            entries: {
                1: { comment: 'Previous', content: 'Old memory', key: ['old'] },
            },
        }, {
            moduleSettings: { defaultMemoryCount: 1 },
        }, contextEntries);

        expect(prompt.indexOf('=== ADDITIONAL CONTEXT FOR REFERENCE ===')).toBeGreaterThan(-1);
        expect(prompt.indexOf('=== ADDITIONAL CONTEXT FOR REFERENCE ===')).toBeLessThan(prompt.indexOf('=== PREVIOUS SCENE CONTEXT'));
        expect(prompt.indexOf('=== PREVIOUS SCENE CONTEXT')).toBeLessThan(prompt.indexOf('=== SCENE TRANSCRIPT ==='));
    });

    it('injects side prompt additional context before scene text', () => {
        const prompt = buildSidePromptText('Update tracker', '', compiledScene, '', [], {}, contextEntries);

        expect(prompt.indexOf('=== ADDITIONAL CONTEXT FOR REFERENCE ===')).toBeGreaterThan(-1);
        expect(prompt.indexOf('=== ADDITIONAL CONTEXT FOR REFERENCE ===')).toBeLessThan(prompt.indexOf('=== SCENE TEXT ==='));
    });

});
