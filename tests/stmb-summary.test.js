import {
    StmbSummaryParseError,
    buildBriefsFromEntries,
    buildSummaryAnalysisPrompt,
    createManagedSummaryEntryData,
    createSummaryCandidatesFromResponse,
    formatSummaryTitle,
    getDefaultSummaryTitleFormat,
    identifyEligibleSummarySourceEntries,
    parseSummaryJsonResponse,
    pluralizeSummaryLabel,
    resolveSelectedSummarySourceEntries,
} from '../public/scripts/stmb-summary.js';

describe('stmb summary helpers', () => {
    it('filters summary candidates from managed memory entries', () => {
        const entries = {
            1: { uid: 1, stmemorybooks: true, comment: '[001] - Memory One', content: 'A' },
            2: { uid: 2, stmemorybooks: true, stmbSummary: true, stmbSummaryTier: 1, comment: '[ARC 001] - Arc One', content: 'B' },
            3: { uid: 3, stmemorybooks: true, disable: true, comment: '[002] - Memory Two', content: 'C' },
        };

        const eligible = identifyEligibleSummarySourceEntries(entries, 1);
        expect(eligible.map(entry => entry.uid)).toEqual([1]);
    });

    it('builds a tier-aware consolidation prompt', () => {
        const prompt = buildSummaryAnalysisPrompt({
            promptText: 'Create summaries for {{childTypePlural}} into {{targetTypePlural}}.',
            briefs: [
                { id: '10', title: '[001] - Opening', content: 'Scene one' },
                { id: '11', title: '[002] - Followup', content: 'Scene two' },
            ],
            targetTier: 1,
        });

        expect(prompt).toContain('=== MEMORIES ===');
        expect(prompt).toContain('=== Memory 001 ===');
        expect(prompt).toContain('Title: [001] - Opening');
        expect(prompt).toContain('"001" or "Memory 001"');
    });

    it('uses tier-aware member_id examples for higher-tier consolidation', () => {
        const prompt = buildSummaryAnalysisPrompt({
            promptText: 'Create summaries for {{childTypePlural}} into {{targetTypePlural}}.',
            briefs: [
                { id: '13', title: '[ARC 001] - Opening Arc', content: 'Arc one' },
                { id: '14', title: '[ARC 002] - Followup Arc', content: 'Arc two' },
            ],
            targetTier: 2,
        });

        expect(prompt).toContain('=== ARCS ===');
        expect(prompt).toContain('=== Arc 001 ===');
        expect(prompt).toContain('"001" or "Arc 001"');
    });

    it('requires resolved consolidation prompt text', () => {
        expect(() => buildSummaryAnalysisPrompt({
            briefs: [{ id: '10', title: '[001] - Opening', content: 'Scene one' }],
            targetTier: 1,
        })).toThrow('STMB consolidation prompt text is required');
    });

    it('parses summary JSON from text envelopes', () => {
        const parsed = parseSummaryJsonResponse('```json\n{"summaries":[{"title":"Arc One","summary":"Summary text","keywords":["apple"],"member_ids":["001"]}],"unassigned_items":[]}\n```');

        expect(parsed.summaries).toHaveLength(1);
        expect(parsed.summaries[0].title).toBe('Arc One');
        expect(parsed.summaries[0].member_ids).toEqual(['001']);
    });

    it('parses Claude tool-use summary payloads', () => {
        const parsed = parseSummaryJsonResponse({
            content: [
                {
                    type: 'tool_use',
                    input: {
                        summaries: [
                            {
                                title: 'Arc One',
                                summary: 'Summary text',
                                keywords: ['apple'],
                                member_ids: ['001'],
                            },
                        ],
                        unassigned_items: [],
                    },
                },
            ],
        });

        expect(parsed.summaries).toHaveLength(1);
        expect(parsed.summaries[0].title).toBe('Arc One');
    });

    it('preserves raw response on malformed summary output', () => {
        try {
            parseSummaryJsonResponse('not valid json');
            throw new Error('expected parse to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(StmbSummaryParseError);
            expect(error.code).toBe('MALFORMED');
            expect(error.rawResponse).toBe('not valid json');
        }
    });

    it('maps member ids back to lorebook entry ids', () => {
        const parsed = {
            summaries: [
                { title: 'Arc One', summary: 'Summary text', keywords: ['apple'], member_ids: ['001', '2'] },
            ],
            unassigned_items: [],
        };
        const sourceEntries = [
            { uid: 10, comment: '[001] - Opening', content: 'Scene one' },
            { uid: 11, comment: '[002] - Followup', content: 'Scene two' },
        ];

        const result = createSummaryCandidatesFromResponse(parsed, sourceEntries);
        expect(result.summaryCandidates).toHaveLength(1);
        expect(result.summaryCandidates[0].memberIds).toEqual(['10', '11']);
    });

    it('maps labeled member ids back to lorebook entry ids', () => {
        const parsed = {
            summaries: [
                { title: 'Opening Arcs', summary: 'Summary text', keywords: ['apple'], member_ids: ['Arc 001', 'Arc 002'] },
                { title: 'Later Arc', summary: 'More summary text', keywords: ['orange'], member_ids: ['Arc 003'] },
            ],
            unassigned_items: [],
        };
        const sourceEntries = [
            { uid: 10, comment: '[ARC 001] - Opening', content: 'Scene one' },
            { uid: 11, comment: '[ARC 002] - Followup', content: 'Scene two' },
            { uid: 12, comment: '[ARC 003] - Later', content: 'Scene three' },
        ];

        const result = createSummaryCandidatesFromResponse(parsed, sourceEntries);
        expect(result.summaryCandidates).toHaveLength(2);
        expect(result.summaryCandidates[0].memberIds).toEqual(['10', '11']);
        expect(result.summaryCandidates[1].memberIds).toEqual(['12']);
    });

    it('infers member ids from text when provided member ids are character names', () => {
        const parsed = {
            summaries: [
                {
                    title: 'Foundations of Power',
                    summary: 'A D-Rank raid, proposal, Beijing dungeon, System interface, and Iron Key establish the opening arc.',
                    keywords: ['D-Rank raid', 'Beijing', 'Iron Key'],
                    member_ids: ['Jinwoo', 'Mari'],
                },
                {
                    title: 'Deals and Destinies',
                    summary: 'Hwang Dong-Suk betrays the party, Jinho makes a contract, and Cerberus guards the Demon Castle.',
                    keywords: ['Hwang Dong-Suk', 'Jinho', 'Cerberus'],
                    member_ids: ['Jinwoo', 'Mari'],
                },
                {
                    title: 'The Red Gate Survival',
                    summary: 'A frozen Red Gate strands the team until Kim Chul falls and Baruka becomes a shadow.',
                    keywords: ['Red Gate', 'Kim Chul', 'Baruka'],
                    member_ids: ['Jinwoo', 'Mari'],
                },
            ],
            unassigned_items: [],
        };
        const sourceEntries = [
            { uid: 10, comment: '[ARC 001] - Opening', content: 'D-Rank raid proposal Beijing dungeon System interface Iron Key' },
            { uid: 11, comment: '[ARC 002] - Betrayal', content: 'Hwang Dong-Suk betrayal Jinho contract Cerberus Demon Castle' },
            { uid: 12, comment: '[ARC 003] - Red Gate', content: 'frozen Red Gate Kim Chul Baruka shadow extraction' },
        ];

        const result = createSummaryCandidatesFromResponse(parsed, sourceEntries);
        expect(result.summaryCandidates).toHaveLength(3);
        expect(result.summaryCandidates[0].memberIds).toEqual(['10']);
        expect(result.summaryCandidates[1].memberIds).toEqual(['11']);
        expect(result.summaryCandidates[2].memberIds).toEqual(['12']);
    });

    it('formats summary titles with tier defaults', () => {
        expect(formatSummaryTitle(1, getDefaultSummaryTitleFormat(1), 'Arc One', 3)).toBe('[ARC 003] - Arc One');
    });

    it('pluralizes tier labels like the reference UI', () => {
        expect(pluralizeSummaryLabel('Memory')).toBe('Memories');
        expect(pluralizeSummaryLabel('Arc')).toBe('Arcs');
    });

    it('creates managed summary lorebook payloads', () => {
        const payload = createManagedSummaryEntryData(
            { title: 'Arc One', summary: 'Summary text', keywords: ['apple'] },
            { targetTier: 1, sequenceNumber: 2 },
        );

        expect(payload.comment).toBe('[ARC 002] - Arc One');
        expect(payload.stmemorybooks).toBe(true);
        expect(payload.stmbSummary).toBe(true);
        expect(payload.stmbSummaryTier).toBe(1);
        expect(payload.type).toBe('arc');
    });

    it('sorts briefs chronologically by numbered title', () => {
        const briefs = buildBriefsFromEntries([
            { uid: 11, comment: '[002] - Followup', content: 'Scene two' },
            { uid: 10, comment: '[001] - Opening', content: 'Scene one' },
        ]);

        expect(briefs.map(brief => brief.id)).toEqual(['10', '11']);
    });

    it('preserves eligible ordering when resolving selected source entries', () => {
        const entries = {
            10: { uid: 10, stmemorybooks: true, comment: '[001] - Opening', content: 'Scene one' },
            11: { uid: 11, stmemorybooks: true, comment: '[002] - Followup', content: 'Scene two' },
            12: { uid: 12, stmemorybooks: true, disable: true, comment: '[003] - Disabled', content: 'Scene three' },
        };

        const resolved = resolveSelectedSummarySourceEntries(entries, 1, ['11', '10', '12']);
        expect(resolved.map(entry => entry.uid)).toEqual([10, 11]);
    });
});
