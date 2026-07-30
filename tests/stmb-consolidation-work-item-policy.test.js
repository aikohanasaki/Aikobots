import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConsolidationWorkItemPrompt } from '../public/scripts/stmb-consolidation-work-item-policy.js';
import {
    STMB_DEFAULT_SUMMARY_PROMPTS,
    buildConsolidationKeywordPrompt,
    buildSummaryAnalysisPrompt,
    parseConsolidationKeywordsResponse,
    resolveConsolidationCandidateKeywords,
} from '../public/scripts/stmb-summary.js';

const selectedPrompt = {
    presetKey: 'arc_alternate',
    promptText: 'selected prompt',
};

test('automatic group prompt is limited to the canonical group work item', () => {
    assert.deepEqual(
        buildConsolidationWorkItemPrompt(
            { role: 'group', hasGroupCharacterTopology: true },
            selectedPrompt,
            'group prompt',
        ),
        { presetKey: 'arc_group_chat', promptText: 'group prompt' },
    );
    assert.deepEqual(
        buildConsolidationWorkItemPrompt(
            { role: 'character', hasGroupCharacterTopology: true },
            selectedPrompt,
            'group prompt',
        ),
        selectedPrompt,
    );
});

test('ordinary and single-book consolidation keeps the selected prompt', () => {
    assert.deepEqual(
        buildConsolidationWorkItemPrompt(
            { role: 'group', hasGroupCharacterTopology: false },
            selectedPrompt,
            'group prompt',
        ),
        selectedPrompt,
    );
});

test('group-chat routing has a structured built-in prompt', () => {
    const prompt = STMB_DEFAULT_SUMMARY_PROMPTS.arc_group_chat;

    assert.match(prompt, /omniscient narrative timeline/i);
    assert.match(prompt, /member_ids/);
    assert.match(prompt, /Preserve who knew, witnessed, concealed, misunderstood, or remained unaware/i);
    assert.match(prompt, /Required `summary` structure/i);
    assert.match(prompt, /Keyword construction/i);
});

test('consolidation framing and keyword fallback use localized strings', () => {
    const localize = (source, key) => key === 'STMemoryBooks_Consolidation_TitleLabel' ? 'Titel' : `[${key}] ${source}`;
    const prompt = buildSummaryAnalysisPrompt({
        briefs: [{ id: '1', title: 'Event', content: 'Something happened.' }],
        promptText: 'Analyze.',
        targetTier: 1,
        localize,
    });
    const keywordPrompt = buildConsolidationKeywordPrompt('A summary.', 1, localize);

    assert.match(prompt, /STMemoryBooks_Consolidation_MemberIdsInstruction/);
    assert.match(prompt, /Titel: Event/);
    assert.match(keywordPrompt, /STMemoryBooks_Consolidation_KeywordSummaryStart/);
});

test('keyword fallback accepts JSON wrappers and plain lists', () => {
    assert.deepEqual(
        parseConsolidationKeywordsResponse('{"keywords":["Chinatown","piano apology","Chinatown"]}'),
        ['Chinatown', 'piano apology'],
    );
    assert.deepEqual(
        parseConsolidationKeywordsResponse('- CPAP machine\n- cookie baking'),
        ['CPAP machine', 'cookie baking'],
    );
});

test('keyword enrichment failure preserves summaries with inherited retrieval keys', async () => {
    const result = await resolveConsolidationCandidateKeywords(
        { title: 'Fallback title', summary: 'Generated summary.', keywords: [] },
        async () => {
            throw new Error('provider failure');
        },
        { fallbackKeywords: ['source hook', 'source hook'] },
    );

    assert.deepEqual(result, {
        keywords: ['source hook'],
        usedFallback: true,
    });
});

test('existing candidate keywords skip enrichment provider calls', async () => {
    let requestCount = 0;
    const result = await resolveConsolidationCandidateKeywords(
        { title: 'Existing title', summary: 'Generated summary.', keywords: ['existing hook'] },
        async () => {
            requestCount++;
            return ['replacement hook'];
        },
    );

    assert.deepEqual(result, {
        keywords: ['existing hook'],
        usedFallback: false,
    });
    assert.equal(requestCount, 0);
});

test('empty keyword enrichment falls back to the candidate title when sources have no keys', async () => {
    const result = await resolveConsolidationCandidateKeywords(
        { title: 'Fallback title', summary: 'Generated summary.', keywords: [] },
        async () => [],
    );

    assert.deepEqual(result, {
        keywords: ['Fallback title'],
        usedFallback: true,
    });
});

test('keyword enrichment still propagates aborts', async () => {
    const abortError = Object.assign(new Error('stopped'), { code: 'ABORTED' });

    await assert.rejects(
        resolveConsolidationCandidateKeywords(
            { title: 'Fallback title', summary: 'Generated summary.', keywords: [] },
            async () => {
                throw abortError;
            },
            { isAbortError: error => error === abortError },
        ),
        error => error === abortError,
    );
});
