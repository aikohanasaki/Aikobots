import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConsolidationWorkItemPrompt } from '../public/scripts/stmb-consolidation-work-item-policy.js';
import {
    STMB_DEFAULT_SUMMARY_PROMPTS,
    buildConsolidationKeywordPrompt,
    buildSummaryAnalysisPrompt,
    parseConsolidationKeywordsResponse,
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
