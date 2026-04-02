import { describe, expect, it } from '@jest/globals';

import {
    STMB_DEFAULT_PROFILE_NAME,
    STMB_MANAGED_FLAG,
    applyStmbMaxTokensToGenerateData,
    compileScene,
    createDefaultStmbSettings,
    createManagedLorebookEntryData,
    findOverlappingManagedMemoryEntry,
    formatMemoryTitle,
    getNextManagedMemorySequenceNumber,
    getRangeFromManagedMemoryEntry,
    identifyManagedMemoryEntries,
    importLegacyStmbSettings,
    normalizeStmbSettings,
    parseSceneRange,
    parseStructuredMemoryResponse,
} from '../public/scripts/stmb-core.js';

describe('stmb core settings', () => {
    it('imports legacy extension settings into the new core schema', () => {
        const legacy = {
            moduleSettings: {
                alwaysUseDefault: true,
                autoCreateLorebook: true,
                titleFormat: '[00] {{title}}',
            },
            profiles: [
                {
                    name: 'Legacy',
                    preset: 'minimal',
                    connection: { api: 'openai', model: 'gpt-4o-mini', temperature: 0.4 },
                },
            ],
        };

        const result = importLegacyStmbSettings(legacy);
        expect(result.moduleSettings.alwaysUseDefault).toBe(true);
        expect(result.moduleSettings.autoCreateLorebook).toBe(true);
        expect(result.titleFormat).toBe('[00] {{title}}');
        expect(result.profiles[0].name).toBe('Legacy');
        expect(result.profiles[0].preset).toBe('minimal');
    });

    it('matches the STMB raw default settings shape before normalization', () => {
        const settings = createDefaultStmbSettings();
        expect(settings.profiles).toHaveLength(0);
    });

    it('normalizes settings using the builtin current settings profile invariants', () => {
        const settings = normalizeStmbSettings();
        expect(settings.profiles).toHaveLength(1);
        expect(settings.profiles[0].name).toBe(STMB_DEFAULT_PROFILE_NAME);
        expect(settings.profiles[0].connection.api).toBe('current_st');
        expect(settings.profiles[0].titleFormat).toBe('[000] - {{title}}');
    });

    it('disables auto-create when manual mode is enabled and fixes duplicate builtin profiles', () => {
        const settings = normalizeStmbSettings({
            moduleSettings: {
                manualModeEnabled: true,
                autoCreateLorebook: true,
            },
            titleFormat: '[000] - {{title}}',
            defaultProfile: 9,
            profiles: [
                {
                    name: 'Legacy Dynamic',
                    useDynamicSTSettings: true,
                    preset: 'summary',
                    connection: { api: 'openai' },
                },
                {
                    name: STMB_DEFAULT_PROFILE_NAME,
                    isBuiltinCurrentST: true,
                    preset: 'summary',
                    connection: { api: 'current_st' },
                },
            ],
        });

        expect(settings.moduleSettings.autoCreateLorebook).toBe(false);
        expect(settings.defaultProfile).toBe(0);
        expect(settings.profiles.filter(profile => profile.isBuiltinCurrentST)).toHaveLength(1);
        expect(settings.profiles[0].connection.api).toBe('current_st');
    });

    it('normalizes non-positive maxTokens back to the STMB default', () => {
        const settings = normalizeStmbSettings({
            moduleSettings: {
                maxTokens: 0,
            },
        });

        expect(settings.moduleSettings.maxTokens).toBe(4000);
    });

    it('syncs legacy arc order fields into summary order fields and summaryEntrySettings', () => {
        const settings = normalizeStmbSettings({
            moduleSettings: {
                arcOrderMode: 'reverse',
                arcOrderValue: 321,
                arcReverseStart: 8765,
            },
        });

        expect(settings.moduleSettings.summaryOrderMode).toBe('reverse');
        expect(settings.moduleSettings.summaryOrderValue).toBe(321);
        expect(settings.moduleSettings.summaryReverseStart).toBe(8765);
        expect(settings.moduleSettings.arcOrderMode).toBe('reverse');
        expect(settings.moduleSettings.arcOrderValue).toBe(321);
        expect(settings.moduleSettings.arcReverseStart).toBe(8765);
        expect(settings.moduleSettings.summaryEntrySettings.orderMode).toBe('reverse');
        expect(settings.moduleSettings.summaryEntrySettings.orderValue).toBe(321);
        expect(settings.moduleSettings.summaryEntrySettings.reverseStart).toBe(8765);
    });

    it('matches STMB config bounds for token threshold, memory count, and auto-summary interval', () => {
        const settings = normalizeStmbSettings({
            moduleSettings: {
                tokenWarningThreshold: 999,
                defaultMemoryCount: 99,
                autoSummaryInterval: 5,
                convertExistingRecursion: 1,
            },
        });

        expect(settings.moduleSettings.tokenWarningThreshold).toBe(50000);
        expect(settings.moduleSettings.defaultMemoryCount).toBe(7);
        expect(settings.moduleSettings.autoSummaryInterval).toBe(100);
        expect(settings.moduleSettings.convertExistingRecursion).toBe(true);
    });

    it('normalizes profile prompt precedence and outlet routing like STMB', () => {
        const settings = normalizeStmbSettings({
            profiles: [
                {
                    name: 'Custom',
                    preset: 'minimal',
                    prompt: 'Use this prompt',
                    position: 0,
                    outletName: 'ignored-outlet',
                    connection: { api: 'openai', model: 'gpt-4.1' },
                },
            ],
        });

        const profile = settings.profiles.find(entry => entry.name === 'Custom');
        expect(profile).toBeDefined();
        expect(profile.prompt).toBe('Use this prompt');
        expect(profile.preset).toBe('');
        expect(profile.outletName).toBe('');
    });

    it('applies STMB max token overrides using the provider-specific token field', () => {
        expect(applyStmbMaxTokensToGenerateData({
            chat_completion_source: 'openai',
            model: 'gpt-5-mini',
            max_tokens: 123,
        }, 4000)).toMatchObject({
            chat_completion_source: 'openai',
            model: 'gpt-5-mini',
            max_completion_tokens: 4000,
        });

        expect(applyStmbMaxTokensToGenerateData({
            chat_completion_source: 'claude',
            model: 'claude-3-7-sonnet',
            max_completion_tokens: 123,
        }, 2048)).toMatchObject({
            chat_completion_source: 'claude',
            model: 'claude-3-7-sonnet',
            max_tokens: 2048,
        });
    });
});

describe('stmb core scene handling', () => {
    it('compiles only visible messages inside the selected range', () => {
        const compiled = compileScene([
            { name: 'Narrator', mes: 'hidden', is_system: true },
            { name: 'User', mes: 'Hello', is_user: true },
            { name: 'Bot', mes: 'Hi there' },
        ], {
            sceneStart: 0,
            sceneEnd: 2,
            chatId: 'chat-1',
            characterName: 'Bot',
            userName: 'User',
        });

        expect(compiled.metadata.hiddenMessagesSkipped).toBe(1);
        expect(compiled.messages).toHaveLength(2);
        expect(compiled.messages[0].mes).toBe('Hello');
    });

    it('rejects malformed scene ranges', () => {
        expect(() => parseSceneRange('12')).toThrow('Scene range must be in x-y format');
    });
});

describe('stmb core parsing and persistence', () => {
    it('parses fenced json responses', () => {
        const parsed = parseStructuredMemoryResponse('```json\n{"title":"Tea","content":"They talked.","keywords":["tea","table","rain"]}\n```');
        expect(parsed.title).toBe('Tea');
        expect(parsed.keywords).toEqual(['tea', 'table', 'rain']);
    });

    it('rejects malformed structured responses', () => {
        expect(() => parseStructuredMemoryResponse('not json')).toThrow('did not contain a JSON block');
    });

    it('formats numbered titles and identifies managed entries in sequence order', () => {
        const title = formatMemoryTitle('[000] - {{title}}', { title: 'Arrival' }, 7);
        expect(title).toBe('[007] - Arrival');

        const entries = {
            1: { uid: 1, comment: '[010] - Later', [STMB_MANAGED_FLAG]: true },
            2: { uid: 2, comment: '[002] - Earlier', [STMB_MANAGED_FLAG]: true },
            3: { uid: 3, comment: 'Ignored', [STMB_MANAGED_FLAG]: false },
        };

        const managed = identifyManagedMemoryEntries(entries);
        expect(managed).toHaveLength(2);
        expect(managed[0].uid).toBe(2);
        expect(managed[1].uid).toBe(1);
    });

    it('uses STMB title-based numbering instead of entry count', () => {
        const next = getNextManagedMemorySequenceNumber({
            1: { uid: 1, comment: '2026-04-01 [007] - Earlier', [STMB_MANAGED_FLAG]: true },
            2: { uid: 2, comment: '2026-04-01 [003] - Older', [STMB_MANAGED_FLAG]: true },
            3: { uid: 3, comment: 'Ignored', [STMB_MANAGED_FLAG]: false },
        }, '{{date}} [000] - {{title}}');

        expect(next).toBe(8);
    });

    it('creates managed lorebook payloads with only STMB memory metadata fields', () => {
        const payload = createManagedLorebookEntryData(
            { title: 'Arrival', content: 'They arrived.', keywords: ['arrival', 'gate', 'dawn'] },
            { sceneStart: 4, sceneEnd: 9, messageCount: 6, chatId: 'chat-1', characterName: 'Bot', userName: 'User' },
            { name: 'Profile A', titleFormat: '[000] - {{title}}' },
            3,
        );

        expect(payload.comment).toContain('[003]');
        expect(payload.STMB_start).toBe(4);
        expect(payload.STMB_end).toBe(9);
        expect(payload.stmemorybooks).toBe(true);
        expect(payload.key).toEqual(['arrival', 'gate', 'dawn']);
        expect(payload.STMB_profile).toBeUndefined();
        expect(payload.STMB_createdAt).toBeUndefined();
    });

    it('reads managed memory scene ranges from STMB metadata', () => {
        expect(getRangeFromManagedMemoryEntry({ STMB_start: 3, STMB_end: 8 })).toEqual({ start: 3, end: 8 });
        expect(getRangeFromManagedMemoryEntry({ STMB_start: '3', STMB_end: 8 })).toBeNull();
    });

    it('finds overlapping managed memories using STMB scene metadata', () => {
        const overlap = findOverlappingManagedMemoryEntry({
            1: { uid: 1, comment: '[001] - Earlier', STMB_start: 2, STMB_end: 6, [STMB_MANAGED_FLAG]: true },
            2: { uid: 2, comment: '[002] - Later', STMB_start: 10, STMB_end: 15, [STMB_MANAGED_FLAG]: true },
            3: { uid: 3, comment: 'Ignored', STMB_start: 4, STMB_end: 9, [STMB_MANAGED_FLAG]: false },
        }, { sceneStart: 5, sceneEnd: 8 });

        expect(overlap).not.toBeNull();
        expect(overlap.title).toBe('[001] - Earlier');
        expect(overlap.range).toEqual({ start: 2, end: 6 });
    });

    it('matches STMB overlap semantics for managed summary-like entries that still carry scene range metadata', () => {
        const overlap = findOverlappingManagedMemoryEntry({
            1: { uid: 1, comment: '[ARC 001] - Summary', STMB_start: 4, STMB_end: 8, stmbSummary: true, [STMB_MANAGED_FLAG]: true },
            2: { uid: 2, comment: '[002] - Later', STMB_start: 20, STMB_end: 25, [STMB_MANAGED_FLAG]: true },
        }, { sceneStart: 6, sceneEnd: 10 });

        expect(overlap).not.toBeNull();
        expect(overlap.title).toBe('[ARC 001] - Summary');
        expect(overlap.range).toEqual({ start: 4, end: 8 });
    });
});
