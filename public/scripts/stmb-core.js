import { cloneStloSettings } from './stlo-utils.js';
import { normalizeCharacterMemoryBookLocks } from './stmb-character-memory-book-locks.js';

export const STMB_PARITY = Object.freeze({
    sourceRepo: 'aikohanasaki/SillyTavern-MemoryBooks',
    sourceCommit: 'cae7ee71d1730b6ee7f6829b955a2b53566a9b02',
});

export const STMB_SETTINGS_VERSION = 6;
export const STMB_METADATA_KEY = 'STMemoryBooks';
export const STMB_MANAGED_FLAG = 'stmemorybooks';
export const STMB_DEFAULT_PROFILE_NAME = 'Current SillyTavern Settings';
export const STMB_DEFAULT_TITLE_FORMAT = '[000] - {{title}}';
export const STMB_DEFAULT_MAX_TOKENS = 4000;
export const STMB_CONNECTION_PROFILE_API_KEY_ERROR = 'please confirm that your API key is entered in Connection Profiles';
export const STMB_MEMORY_BOUNDARY_MODES = Object.freeze({
    OFF: '',
    DIVIDER: 'divider',
    BUTTON: 'button',
    BOTH: 'both',
});
const STMB_MEMORY_BOUNDARY_MODE_VALUES = new Set(Object.values(STMB_MEMORY_BOUNDARY_MODES));
export const STMB_DEFAULT_COMPACTION_PROMPT_TEMPLATE = `Please aggressively make this lorebook entry more token-efficient while retaining as much useful information as possible.

Rules:
- Preserve all important facts, preferences, relationships, names, unresolved plot points, promises, secrets, constraints, and character-specific details.
- Remove redundancy, filler, repeated phrasing, and low-value wording.
- Merge overlapping bullets where possible.
- Keep the entry readable as a lorebook entry.
- Do not add new facts.
- Do not invent explanations.
- Do not change names, pronouns, macros, or proper nouns.
- Preserve wrapper headings and end markers exactly if present.
- Return only the revised entry content.

Entry type:
{{ENTRY_KIND}}

Entry title:
{{ENTRY_TITLE}}

Entry content:
{{ENTRY_CONTENT}}`;

const STMB_REVERSE_PROXY_PROFILE_APIS = new Set(['openai', 'claude', 'mistralai', 'makersuite', 'vertexai', 'deepseek', 'xai']);
const STMB_OPENAI_COMPAT_GENERATE_DATA = Symbol('stmbOpenAICompatGenerateData');

export const STMB_DEFAULT_TITLE_FORMATS = Object.freeze([
    '[000] - {{title}} ({{profile}})',
    '{{date}} [000] 🎬{{title}}, {{messages}} msgs',
    '[000] {{date}} - {{char}} Memory',
    '[00] - {{user}} & {{char}} {{scene}}',
    '🧠 [000] ({{messages}} msgs)',
    '📚 Memory #[000] - {{profile}} {{date}} {{time}}',
    '[000] - {{scene}}: {{title}}',
    '[000] - {{title}} ({{scene}})',
    '[000] - {{title}}',
]);

export function normalizeStmbMemoryBoundaryMode(mode) {
    const value = String(mode ?? STMB_MEMORY_BOUNDARY_MODES.BOTH);
    return STMB_MEMORY_BOUNDARY_MODE_VALUES.has(value) ? value : STMB_MEMORY_BOUNDARY_MODES.BOTH;
}

function normalizeStmbMemoryBoundaryButtonPosition(position) {
    if (!position || typeof position !== 'object') {
        return null;
    }

    const left = Number(position.left);
    const top = Number(position.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
    }

    return {
        left: Math.round(left),
        top: Math.round(top),
    };
}

export const STMB_DEFAULT_PROMPTS = Object.freeze({
    summary: `You are a talented summarist skilled at capturing scenes from stories comprehensively. Analyze the following roleplay scene and return a detailed memory as JSON.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short scene title (1-3 words)",
  "content": "Detailed beat-by-beat summary in narrative prose...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

For the content field, create a detailed beat-by-beat summary in narrative prose. First, note the dates/time. Then capture this scene accurately without losing ANY important information EXCEPT FOR [OOC] conversation/interaction. All [OOC] conversation/interaction is not useful for summaries.
This summary will go in lorebook entry, so include:
- All important story beats/events that happened
- Key interaction highlights and character developments
- Notable details, memorable quotes, and revelations
- Outcome and anything else important for future interactions between {{user}} and {{char}}
Capture ALL nuance without repeating verbatim. Make it comprehensive yet digestible.

For the keywords field, provide 15-30 specific, descriptive, relevant keywords for keyword retrieval via word-matching in chat context. Keywords must be concrete and scene-specific (locations, objects, proper nouns, unique actions). Do not use abstract themes (e.g., "sadness", "love") or character names.

Return ONLY the JSON, no other text.`,
    group: `Analyze the following roleplay scene and create a memory entry from an omniscient POV.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short, descriptive scene title (3-6 words)",
  "content": "Structured memory summary...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

- Write the memory as continuity relevant to the target group as a shared unit.
- Include shared events, mutual decisions, group plans, promises, conflicts, secrets, relationship shifts, unresolved tensions, and facts that affect the group dynamic.
- Include individual actions or emotions only when they changed the shared group state.
- Do not create a merged personality for the group. Keep attribution clear: Alice did X, Bob thought Y, both agreed Z.
- If only one member knows something, say so. Do not imply shared knowledge unless the scene supports it.

For the content field, use this markdown structure:

# [Scene Title]
**Timeline**: (date/day/time, if known)

## Target-Relevant Events
- Summarize the events that matter to this group in chronological order.
- Use cause -> intention -> reaction -> consequence logic.
- Exclude flavor-only details unless they reveal a lasting character or relationship change.

## Attribution
- Clearly state who did what.
- Clearly state who knew what.
- Clearly state who felt, believed, suspected, misunderstood, or intended what.
- Do not assign private thoughts or emotions to a character unless the scene text supports them.

## Continuity Impact
- Record what should matter in future scenes: decisions, injuries, promises, secrets, changed relationships, new knowledge, unresolved threads, practical consequences, emotional shifts, or altered trust.
- Separate shared knowledge from member-specific knowledge.

## Exclusions
- Ignore and exclude all [OOC] or meta discussion.
- Do not include unsupported assumptions.
- Do not collapse multiple characters into vague phrases like "they felt" unless every target member clearly felt it.

For the keywords field:
- Generate 15-30 standalone topical keywords for retrieval.
- Keywords must be concrete and scene-specific: locations, objects, proper nouns, unique actions, repeated motifs, plans, injuries, named events, or distinctive phrases.
- Do not use abstract themes.
- Do not use these major character names as keywords: {{group}}. NPC names may be used if the NPC played a major role.
- Prefer keywords that would fire if the user later mentions the noun/action alone.

Return ONLY the JSON, no additional text.`,
    char: `Analyze the following scene and create a memory entry written with {{char}} as the focus.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short, descriptive scene title (3-6 words)",
  "content": "Structured memory summary...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

Important: This is NOT a general scene summary. This is a targeted memory entry.
- Write the memory as continuity relevant to {{char}}.
- Include what {{char}} did, said, thought, felt, noticed, learned, decided, promised, concealed, misunderstood, or was affected by.
- Include other characters depending on how their actions, words, emotions, or decisions matter to {{char}}'s future continuity.
- Do not include information {{char}} could not know unless it directly affects future continuity and is clearly marked as external scene knowledge.
- Attribute all actions, thoughts, emotions, and knowledge clearly. Do not blur characters together.

For the content field, use this markdown structure:

# [Scene Title]
**Timeline**: (date/day/time, if known)

## Target-Relevant Events
- Summarize the events that matter to {{char}} in chronological order.
- Use cause -> intention -> reaction -> consequence logic.
- Exclude flavor-only details unless they reveal a lasting character or relationship change.

## Attribution
- Clearly state who did what.
- Clearly state who knew what.
- Clearly state who felt, believed, suspected, misunderstood, or intended what.
- Do not assign private thoughts or emotions to a character unless the scene text supports them.

## Continuity Impact
- Record what should matter in future scenes: decisions, injuries, promises, secrets, changed relationships, new knowledge, unresolved threads, practical consequences, emotional shifts, or altered trust.
- Separate shared knowledge from member-specific knowledge.

## Exclusions
- Ignore and exclude all [OOC] or meta discussion.
- Do not summarize the whole scene if it is not relevant to {{char}}.
- Do not include unsupported assumptions.

For the keywords field, generate 15-30 specific, descriptive, highly relevant keywords for database retrieval - focus on the most important topical terms. Keywords must be concrete and scene-specific (locations, objects, proper nouns, unique actions). No compound keywords unless they are proper nouns. Do not use abstract themes (e.g., "sadness", "love") or character names.

Return ONLY the JSON, no additional text.`,
    summarize: `Analyze the following roleplay scene and return a structured summary as JSON.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short scene title (1-3 words)",
  "content": "Detailed summary with markdown headers...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

For the content field, create a detailed bullet-point summary using markdown with these headers (but skip and ignore all OOC conversation/interaction):
- **Timeline**: Day/time this scene covers.
- **Story Beats**: List all important plot events and story developments that occurred.
- **Key Interactions**: Describe the important character interactions, dialogue highlights, and relationship developments.
- **Notable Details**: Mention any important objects, settings, revelations, or details that might be relevant for future interactions.
- **Outcome**: Summarize the result, resolution, or state of affairs at the end of the scene.

For the keywords field, provide 15-30 specific, descriptive, relevant keywords that would help a keyworded database find this conversation again if something is mentioned. Keywords must be concrete and scene-specific (locations, objects, proper nouns, unique actions). Do not use abstract themes (e.g., "sadness", "love") or character names.

Ensure you capture ALL important information - comprehensive detail is more important than brevity.

Return ONLY the JSON, no other text.`,
    synopsis: `Analyze the following roleplay scene and return a comprehensive synopsis as JSON.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short scene title (1-3 words)",
  "content": "Long detailed synopsis with markdown structure...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

For the content field, create a long and detailed beat-by-beat summary using markdown structure. Capture the most recent scene accurately without losing ANY information. [OOC] conversation/interaction is not useful for summaries and should be ignored and excluded. Use this structure:
# [Scene Title]
**Timeline**: (day/time)
## Story Beats
- (List all important plot events and developments)
## Key Interactions
- (Detail all significant character interactions and dialogue)
## Notable Details
- (Include memorable quotes, revelations, objects, settings)
## Outcome
- (Describe results, resolutions, and final state)

Include EVERYTHING important for future interactions between {{user}} and {{char}}. Capture all nuance without regurgitating verbatim.

For the keywords field, provide 15-30 specific, descriptive, relevant keywords for keyworded database retrieval. Keywords must be concrete and scene-specific (locations, objects, proper nouns, unique actions). Do not use abstract themes (e.g., "sadness", "love") or character names.

Return ONLY the JSON, no other text.`,
    sumup: `Analyze the following roleplay scene and return a beat summary as JSON.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short scene title (1-3 words)",
  "content": "Comprehensive beat summary...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

For the content field, write a comprehensive beat summary that captures this scene completely. Format it as:
# Scene Summary - Day X - [Title]
First note the dates/time covered by the scene. Then narrate ALL important story beats/events that happened, key interaction highlights, notable details, memorable quotes, character developments, and outcome. Ensure no important information is lost. [OOC] conversation/interaction is not useful for summaries and should be ignored and excluded. 

For the keywords field, provide 15-30 specific, descriptive, relevant keywords that would help a keyworded database find this summary again if mentioned. Keywords must be concrete and scene-specific (locations, objects, proper nouns, unique actions). Do not use abstract themes (e.g., "sadness", "love") or character names.

Return ONLY the JSON, no other text.`,
    minimal: `Analyze the following roleplay scene and return a minimal memory entry as JSON.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short scene title (1-3 words)",
  "content": "Brief 2-5 sentence summary...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

For the content field, provide a very brief 2-5 sentence summary of what happened in this scene. [OOC] conversation/interaction is not useful for summaries and should be ignored and excluded.

For the keywords field, generate 15-30 specific, descriptive, highly relevant keywords for database retrieval - focus on the most important terms that would help find this scene later. Keywords must be concrete and scene-specific (locations, objects, proper nouns, unique actions). Do not use abstract themes (e.g., "sadness", "love") or character names.

Return ONLY the JSON, no other text.`,
    northgate: `You are a memory archivist for a long-form narrative. Your function is to analyze the provided scene and extract all pertinent information into a structured JSON object.

You must respond with ONLY valid JSON in this exact format:
{
"title": "Concise Scene Title (3-5 words)",
"content": "A detailed, literary summary of the scene written in a third-person, past-tense narrative style. Capture all key actions, emotional shifts, character development, and significant dialogue. Focus on "showing" what happened through concrete details. Ensure the summary is comprehensive enough to serve as a standalone record of the scene's events and their impact on the characters.",
"keywords": ["keyword1", "keyword2", "keyword3"]
}

For the "content" field, write with literary quality. Do not simply list events; synthesize them into a coherent narrative block.

For the "keywords" field, provide 15-30 specific and descriptive keywords that capture the scene's core elements. Keywords must be concrete and scene-specific (locations, objects, proper nouns, unique actions). Do not use abstract themes (e.g., "sadness", "love") or character names.

Return ONLY the JSON object, with no additional text or explanations.`,
    aelemar: `You are a meticulous archivist, skilled at accurately capturing all key plot points and memories from a story. Analyze the following story scene and extract a detailed summary as JSON.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Concise scene title (3-5 words)",
  "content": "Detailed summary of key plot points and character memories, beat-by-beat in narrative prose...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

For the content field, create a beat-by-beat summary in narrative prose. Capture all key plot points that advance the story and character memories that leave a lasting impression, ensuring nothing essential is omitted. This summary will go in a keyworded database, so include: 

- Story beats, events, actions and consequences, turning points, and outcomes
- Key character interactions, character developments, significant dialogue, revelations, emotional impact, and relationships
- Outcomes and anything else important for future interactions between the user and the world
Capture ALL nuance without repeating verbatim. Do not simply list events; synthesize them into a coherent narrative block. This summary must be comprehensive enough to serve as a standalone record of the story so far, even if the original text is lost. Use at least 300 words. Avoid redundancy.

For the keywords field, provide 15-30 specific and descriptive keywords that capture the scene's core elements. Keywords must be concrete and scene-specific (locations, objects, proper nouns, unique actions). Do not use abstract themes (e.g., "sadness", "love") or character names.

Return ONLY the JSON, no other text.`,
    comprehensive: `Analyze the following roleplay scene in the context of previous summaries provided (if available) and return a comprehensive synopsis as JSON.

You must respond with ONLY valid JSON in this exact format:
{
  "title": "Short, descriptive scene title (3-6 words)",
  "content": "Long detailed synopsis with markdown structure...",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

For the content field, create a beat-by-beat summary of the scene that *replaces reading the full scene* while preserving all plot-relevant nuance and reads like a clean, structured scene log — concise yet complete. This summary needs to be token-efficient: exercise judgment as to whether or not an interaction is flavor-only or truly affects the plot. Flavor scenes (interaction detail that does not advance plot) may be captured through key exchanges and should be skipped when recording story beats. 

Write in **past tense**, **third-person**, and exclude all [OOC] or meta discussion.  
Use concrete nouns (e.g., “rice cooker” > “appliance”).  
Only use adjectives/adverbs when they materially affect tone, emotion, or characterization.  
Focus on **cause → intention → reaction → consequence** chains for clarity and compression.

The \`content\` field must use this structure:

# [Scene Title]

**Timeline**: [Most specific date and time supported by the source entries; if unspecified, state unspecified or use relative time.]

## Story Beats

* Present the major actions, revelations, decisions, and emotional or magical shifts in chronological order.
* Explain what triggered each development, why characters acted, how others reacted, and what resulted.
* Include plot-affecting interactions, meaningful shared experiences, and events that changed relationships or future continuity.
* Omit repeated gestures, room dressing, background objects, and logistical detail unless they directly affected events.

## Character Dynamics

* Explain how motives, emotions, relationships, and power dynamics changed during the summarized period.
* Capture consequential subtext, tension, vulnerability, trust, conflict, avoidance, affection, resentment, or loyalty.
* Include small or domestic experiences only when they meaningfully shaped relationship history.
* Do not repeat plot events unless needed to explain the interpersonal change they caused.

## Important Facts

* Record newly established facts likely to matter later, including plans, risks, abilities, limitations, preferences, promises, secrets, debts, injuries, magical effects, discoveries, and obligations.
* Exclude casual preferences, scenery, errands, paperwork, clothing, furniture, weather, and other incidental details unless they became continuity-relevant.

## Key Exchanges

* Include only dialogue that defined a revelation, decision, conflict, emotional shift, or relationship change.
* Attribute each quotation by speaker name.
* Include a direct quotation only when the source entries preserve its exact wording. Never reconstruct quoted dialogue from a paraphrase.
* Preserve distinctive phrases or identifiers, such as “pack for forever” or “dick-measuring contest,” only when they are memorable or relationship-relevant.
* Include no more than 8 quotations.

## Outcome & Continuity

* State the final narrative, emotional, relational, physical, or magical condition produced by the events.
* Record resulting decisions, plans, risks, promises, secrets, injuries, knowledge, and obligations that affect what happens next.
* Identify unresolved threads, pending conflicts, future consequences, and foreshadowed developments.
* Do not recap the full sequence of events again.

For the \`keywords\` field:

Generate **12–20 natural retrieval keywords when the material supports them**. Use fewer rather than padding the list with weak terms. Keywords are search hooks, not miniature summaries or evidence notes.

Prioritize:

1. **Stable named entities**: people other than {{char}} or {{user}}, places, organizations, events, documents, factions, spells, or distinctive objects.
2. **Major continuity anchors**: plans, threats, secrets, discoveries, investigations, conflicts, injuries, promises, relationship changes, and unresolved threads.
3. **Memorable moments**: meaningful shared activities, gifts, food, rituals, jokes, care-taking, arguments, or domestic events.
4. **Independent secondary hooks** that retrieve a separate part of the summarized material.

### Keyword construction

Use the shortest distinctive wording likely to remain recognizable under paraphrasing or reversed word order.

Examples:

* \`Gala of the Silver Rose\` or \`Silver Rose Gala\` → \`Silver Rose\`
* \`Bromet Response SA\` → \`Bromet\`
* \`Château D’Aramitz\`, Comte D’Aramitz, or a plan involving him → \`D’Aramitz\`
* Keep \`Althof Ledger\` when both words are required to identify the object.

Prefer one central named entity when it already covers several related events:

* \`D’Aramitz rescue plan\` → \`D’Aramitz\`
* \`Bromet hidden contractors\` → \`Bromet\`
* \`Althof Ledger substitution\` → \`Althof Ledger\`

Retain a modified phrase only when it provides an independent retrieval route not covered by the central entity:

* \`fake caterers\`
* \`ledger facsimile\`
* \`safehouse breakfast\`
* \`counter-surveillance camera\`

When several clues establish one conclusion, usually tag the resulting finding rather than each supporting clue:

* Uniforms, badges, and vehicle access → \`fake caterers\`
* Payments and company records → \`Bromet\`
* A covert tactical team at the gala → \`suspected assassination\`
* A rental used for equipment and disguises → \`staging villa\`

A supporting clue may remain only when it is memorable, likely to recur, or independently useful for retrieval.

Keywords should normally:

* Contain 1–4 words.
* Use ordinary noun phrases.
* Identify genuinely distinct parts of the summary.
* Remain stable if later descriptions use different wording.

Exclude:

* Incidental scenery or props.
* Exact times, quantities, card digits, invoice wording, or administrative details.
* Generic themes such as \`danger\`, \`romance\`, or \`conversation\`.
* Unsupported conclusions.
* Sentence-like evidence descriptions.
* Multiple keywords that merely restate or narrow the same named entity.

Before returning the JSON, silently verify that each keyword is natural to search, continuity-relevant, stable under paraphrasing, independently useful, and no longer than necessary.

Return ONLY the JSON — no additional text.`,
});

export const STMB_DEFAULT_MEMORY_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['title', 'content', 'keywords'],
    properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        keywords: {
            type: 'array',
            items: { type: 'string' },
        },
    },
});

export const DEFAULT_LOREBOOK_ENTRY_SETTINGS = Object.freeze({
    constVectMode: 'link',
    position: 0,
    outletName: '',
    orderMode: 'auto',
    orderValue: 100,
    reverseStart: 9999,
    preventRecursion: false,
    delayUntilRecursion: false,
    ignoreBudget: false,
});

const VALID_LOREBOOK_POSITIONS = new Set([0, 1, 2, 3, 5, 6, 7]);

export class StmbStructuredParseError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'StmbStructuredParseError';
        this.code = code;
        this.recoverable = Boolean(options.recoverable);
        this.rawResponse = typeof options.rawResponse === 'string' ? options.rawResponse : '';
    }
}

export function createDefaultStmbProfile() {
    return {
        name: STMB_DEFAULT_PROFILE_NAME,
        isBuiltinCurrentST: true,
        preset: 'summary',
        useGroupSpecificPrompts: false,
        groupPreset: 'group',
        characterPreset: 'char',
        skipStructuredOutput: false,
        streaming: false,
        connectionProfileId: '',
        connectionProfileName: '',
        modelOverride: '',
        temperatureOverride: null,
        connection: {
            api: 'current_st',
        },
        constVectMode: 'link',
        position: 0,
        outletName: '',
        orderMode: 'auto',
        orderValue: 100,
        preventRecursion: false,
        delayUntilRecursion: false,
        ignoreBudget: false,
    };
}

/** Applies or clears a central connection profile binding on an STMB profile. */
export function applyStmbConnectionProfileSelection(profile, connectionProfileId, connectionProfileName = '') {
    const normalizedId = String(connectionProfileId || '').trim();
    if (normalizedId) {
        profile.connectionProfileId = normalizedId;
        profile.connectionProfileName = String(connectionProfileName || '');
        profile.connection = { api: 'connection_profile' };
    } else {
        profile.connectionProfileId = '';
        profile.connectionProfileName = '';
        if (String(profile.connection?.api || '') === 'connection_profile') {
            profile.connection = { api: 'current_st' };
        }
    }
    return profile;
}

/** Resolves the non-secret connection details shown for an STMB profile. */
export function resolveStmbProfileConnectionSummary(profile, options = {}) {
    const {
        currentUiConnection = {},
        connectionProfile = {},
        connectionSnapshot = {},
    } = options;
    const connection = profile?.connection || {};
    const usesConnectionProfile = Boolean(profile?.connectionProfileId || connectionSnapshot?.profileId);
    const modelOverride = String(profile?.modelOverride || '').trim();
    const temperatureOverride = profile?.temperatureOverride;
    const modelIsOverride = Boolean(modelOverride);
    const temperatureIsOverride = temperatureOverride !== null
        && temperatureOverride !== undefined
        && Number.isFinite(Number(temperatureOverride));

    if (usesConnectionProfile) {
        return {
            usesConnectionProfile,
            connectionProfileName: String(
                connectionSnapshot?.profileName
                || profile?.connectionProfileName
                || connectionProfile?.name
                || '',
            ),
            provider: String(connectionSnapshot?.source || connectionProfile?.api || ''),
            model: modelOverride || String(connectionSnapshot?.model || connectionProfile?.model || ''),
            temperature: temperatureIsOverride
                ? Number(temperatureOverride)
                : connectionSnapshot?.temperature,
            modelIsOverride,
            temperatureIsOverride,
        };
    }

    const usesCurrentUi = String(connection.api || 'current_st') === 'current_st';
    return {
        usesConnectionProfile: false,
        connectionProfileName: '',
        provider: String(usesCurrentUi ? (currentUiConnection?.api || 'openai') : (connection.api || 'openai')),
        model: modelOverride || String(usesCurrentUi ? (currentUiConnection?.model || '') : (connection.model || '')),
        temperature: temperatureIsOverride
            ? Number(temperatureOverride)
            : (usesCurrentUi ? currentUiConnection?.temperature : connection.temperature),
        modelIsOverride,
        temperatureIsOverride,
    };
}

export function createDefaultStmbSettings() {
    return {
        parity: { ...STMB_PARITY },
        moduleSettings: {
            alwaysUseDefault: true,
            showMemoryPreviews: false,
            showNotifications: true,
            unhideBeforeMemory: false,
            refreshEditor: true,
            maxTokens: STMB_DEFAULT_MAX_TOKENS,
            tokenWarningThreshold: 50000,
            defaultMemoryCount: 0,
            autoClearSceneAfterMemory: false,
            manualModeEnabled: false,
            autoAcceptGroupParticipants: false,
            allowSceneOverlap: false,
            autoHideMode: 'all',
            unhiddenEntriesCount: 2,
            showConsolidationPreviews: false,
            autoSummaryEnabled: false,
            autoSummaryInterval: 50,
            autoSummaryBuffer: 2,
            convertExistingRecursion: false,
            autoConsolidationPromptEnabled: false,
            autoConsolidationTargetTiers: [1],
            autoCreateLorebook: false,
            lorebookNameTemplate: 'LTM - {{char}} - {{chat}}',
            lorebookOrderDefaults: null,
            showFloatingClipButton: true,
            copyMemoryBooksWithChatCopies: true,
            memoryBoundaryMode: STMB_MEMORY_BOUNDARY_MODES.BOTH,
            memoryBoundaryButtonPosition: null,
            chatEndButtonPosition: null,
            compactionPromptTemplate: STMB_DEFAULT_COMPACTION_PROMPT_TEMPLATE,
            topicalClipPromptTemplate: '',
            compactionProfileIndex: 0,
            sidePromptsMaxConcurrent: 1,
            defaultSoloSidePromptSetKey: '',
            defaultGroupSidePromptSetKey: '',
            useRegex: false,
            selectedRegexOutgoing: [],
            selectedRegexIncoming: [],
            defaultArcPromptKey: 'arc_default',
            arcOrderMode: 'auto',
            arcOrderValue: 100,
            arcReverseStart: 9999,
            summaryOrderMode: 'auto',
            summaryOrderValue: 100,
            summaryReverseStart: 9999,
            summaryEntrySettings: { ...DEFAULT_LOREBOOK_ENTRY_SETTINGS },
            summaryTierMinimums: { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5 },
        },
        titleFormat: STMB_DEFAULT_TITLE_FORMAT,
        promptPresets: {},
        promptPresetMetadata: {},
        arcPromptPresets: {},
        arcPromptPresetMetadata: {},
        profiles: [],
        defaultProfile: 0,
        characterMemoryBookLocks: {},
        migrationVersion: STMB_SETTINGS_VERSION,
    };
}

function clampOrderValue(value, fallback = 100) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(9999, Math.max(0, Math.trunc(num)));
}

function clampReverseStart(value, fallback = 9999) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(9999, Math.max(100, Math.trunc(num)));
}

function normalizeLorebookPosition(value, fallback = 0) {
    const num = Number(value);
    const position = Number.isFinite(num) ? Math.trunc(num) : fallback;
    return VALID_LOREBOOK_POSITIONS.has(position) ? position : fallback;
}

function normalizeSummaryTierMinimums(rawValue, fallbackValue) {
    const result = {};
    const source = rawValue && typeof rawValue === 'object' ? rawValue : fallbackValue;
    for (let tier = 1; tier <= 6; tier++) {
        const candidate = source?.[tier] ?? source?.[String(tier)] ?? fallbackValue?.[tier];
        const parsed = Number(candidate);
        result[tier] = Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 5;
    }
    return result;
}

function sanitizeProfile(rawProfile) {
    const fallback = createDefaultStmbProfile();
    const profile = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
    const connection = profile.connection && typeof profile.connection === 'object' ? profile.connection : {};
    const connectionProfileId = typeof profile.connectionProfileId === 'string' ? profile.connectionProfileId.trim() : '';
    const connectionApi = connectionProfileId
        ? 'connection_profile'
        : (typeof connection.api === 'string' && connection.api.trim() ? connection.api.trim() : fallback.connection.api);
    const position = normalizeLorebookPosition(profile.position, fallback.position);
    const preset = typeof profile.preset === 'string' && profile.preset.trim() ? profile.preset.trim() : fallback.preset;
    const sanitized = {
        name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : fallback.name,
        isBuiltinCurrentST: Boolean(profile.isBuiltinCurrentST),
        preset,
        useGroupSpecificPrompts: Boolean(profile.useGroupSpecificPrompts),
        groupPreset: typeof profile.groupPreset === 'string' && profile.groupPreset.trim() ? profile.groupPreset.trim() : fallback.groupPreset,
        characterPreset: typeof profile.characterPreset === 'string' && profile.characterPreset.trim()
            ? profile.characterPreset.trim()
            : (typeof profile.charPreset === 'string' && profile.charPreset.trim() ? profile.charPreset.trim() : fallback.characterPreset),
        skipStructuredOutput: Boolean(profile.skipStructuredOutput),
        streaming: Boolean(profile.streaming),
        connectionProfileId,
        connectionProfileName: typeof profile.connectionProfileName === 'string' ? profile.connectionProfileName.trim() : '',
        modelOverride: typeof profile.modelOverride === 'string'
            ? profile.modelOverride.trim()
            : (typeof connection.model === 'string' ? connection.model.trim() : ''),
        temperatureOverride: profile.temperatureOverride !== null
            && profile.temperatureOverride !== ''
            && Number.isFinite(Number(profile.temperatureOverride))
            ? Math.max(0, Math.min(2, Number(profile.temperatureOverride)))
            : (connection.temperature !== null
                && connection.temperature !== ''
                && connection.temperature !== undefined
                && Number.isFinite(Number(connection.temperature))
                ? Math.max(0, Math.min(2, Number(connection.temperature)))
                : null),
        connection: {
            api: connectionApi,
        },
        constVectMode: typeof profile.constVectMode === 'string' && profile.constVectMode.trim() ? profile.constVectMode.trim() : fallback.constVectMode,
        position,
        outletName: position === 7 && typeof profile.outletName === 'string' ? profile.outletName.trim() : fallback.outletName,
        orderMode: typeof profile.orderMode === 'string' && profile.orderMode.trim() ? profile.orderMode.trim() : fallback.orderMode,
        orderValue: clampOrderValue(profile.orderValue, fallback.orderValue),
        reverseStart: clampReverseStart(profile.reverseStart, fallback.reverseStart),
        preventRecursion: Boolean(profile.preventRecursion),
        delayUntilRecursion: Boolean(profile.delayUntilRecursion),
        ignoreBudget: Boolean(profile.ignoreBudget),
    };

    if (!connectionProfileId) {
        if (typeof connection.model === 'string') sanitized.connection.model = connection.model;
        if (connection.temperature !== null
            && connection.temperature !== ''
            && connection.temperature !== undefined
            && Number.isFinite(Number(connection.temperature))) {
            sanitized.connection.temperature = Number(connection.temperature);
        } else if (connectionApi !== 'current_st') sanitized.connection.temperature = 0.7;
        if (typeof connection.endpoint === 'string') sanitized.connection.endpoint = connection.endpoint;
        if (typeof connection.apiKey === 'string') sanitized.connection.apiKey = connection.apiKey;
    }
    if (typeof profile.titleFormat === 'string' && profile.titleFormat.trim()) sanitized.titleFormat = profile.titleFormat;
    if (profile.useDynamicSTSettings !== undefined) sanitized.useDynamicSTSettings = Boolean(profile.useDynamicSTSettings);

    return sanitized;
}

export function validateAndFixStmbProfiles(settings = {}) {
    const fixes = [];
    const nextSettings = settings && typeof settings === 'object' ? settings : {};

    if (!Array.isArray(nextSettings.profiles)) {
        nextSettings.profiles = [];
        fixes.push('Created empty profiles array');
    }

    nextSettings.profiles = nextSettings.profiles.map(profile => sanitizeProfile(profile));

    for (const profile of nextSettings.profiles) {
        if (profile?.useDynamicSTSettings) {
            profile.connection = profile.connection && typeof profile.connection === 'object' ? profile.connection : {};
            profile.connection.api = 'current_st';
            profile.isBuiltinCurrentST = true;
            delete profile.useDynamicSTSettings;
            fixes.push(`Migrated legacy dynamic profile "${profile.name}" to provider-based current_st`);
        }
    }

    if (nextSettings.profiles.length === 0) {
        nextSettings.profiles.push(createDefaultStmbProfile());
        fixes.push('Added default profile using provider "Current SillyTavern Settings".');
    }

    const builtinIndices = [];
    for (let index = 0; index < nextSettings.profiles.length; index++) {
        if (nextSettings.profiles[index]?.isBuiltinCurrentST) {
            builtinIndices.push(index);
        }
    }

    if (builtinIndices.length === 0) {
        let candidateIndex = nextSettings.profiles.findIndex(
            profile => profile?.connection?.api === 'current_st' && profile?.name === STMB_DEFAULT_PROFILE_NAME,
        );
        if (candidateIndex < 0) {
            candidateIndex = nextSettings.profiles.findIndex(
                profile => profile?.connection?.api === 'current_st' && profile?.preset === 'summary',
            );
        }
        if (candidateIndex < 0) {
            candidateIndex = nextSettings.profiles.findIndex(profile => profile?.connection?.api === 'current_st');
        }

        if (candidateIndex >= 0) {
            nextSettings.profiles[candidateIndex].isBuiltinCurrentST = true;
            fixes.push(`Marked existing profile "${nextSettings.profiles[candidateIndex].name}" as builtin Current ST profile`);
        } else {
            nextSettings.profiles.unshift(createDefaultStmbProfile());
            if (Number.isFinite(Number(nextSettings.defaultProfile))) {
                nextSettings.defaultProfile = Number(nextSettings.defaultProfile) + 1;
            }
            fixes.push('Added missing builtin Current ST profile.');
        }
    } else if (builtinIndices.length > 1) {
        for (let index = 1; index < builtinIndices.length; index++) {
            delete nextSettings.profiles[builtinIndices[index]].isBuiltinCurrentST;
        }
        fixes.push('Fixed multiple builtin Current ST profiles (kept first, cleared others).');
    }

    for (const profile of nextSettings.profiles) {
        if (profile?.isBuiltinCurrentST) {
            profile.name = STMB_DEFAULT_PROFILE_NAME;
            profile.connectionProfileId = '';
            profile.connectionProfileName = '';
            profile.connection = { api: 'current_st' };
        }

        if (!profile.titleFormat) {
            profile.titleFormat = nextSettings.titleFormat || STMB_DEFAULT_TITLE_FORMAT;
            fixes.push(`Added missing title format to profile "${profile.name}"`);
        }
    }

    if (!Number.isFinite(Number(nextSettings.defaultProfile)) || nextSettings.defaultProfile < 0 || nextSettings.defaultProfile >= nextSettings.profiles.length) {
        nextSettings.defaultProfile = 0;
        fixes.push('Fixed invalid default profile index');
    }

    return {
        settings: nextSettings,
        fixes,
    };
}

function getPotentialModuleSettings(source) {
    if (!source || typeof source !== 'object') return {};
    if (source.moduleSettings && typeof source.moduleSettings === 'object') return source.moduleSettings;

    const defaults = createDefaultStmbSettings().moduleSettings;
    const flat = {};
    for (const key of Object.keys(defaults)) {
        if (key in source) flat[key] = source[key];
    }
    return flat;
}

export function normalizeLorebookEntrySettings(settings = {}, defaults = DEFAULT_LOREBOOK_ENTRY_SETTINGS) {
    const base = { ...DEFAULT_LOREBOOK_ENTRY_SETTINGS, ...(defaults || {}) };
    const constVectModeRaw = String(settings?.constVectMode ?? base.constVectMode).toLowerCase();
    const orderModeRaw = String(settings?.orderMode ?? base.orderMode).toLowerCase();

    return {
        constVectMode: ['blue', 'green', 'link'].includes(constVectModeRaw) ? constVectModeRaw : 'link',
        position: normalizeLorebookPosition(settings?.position, normalizeLorebookPosition(base.position, 0)),
        outletName: String(settings?.outletName ?? base.outletName ?? '').trim(),
        orderMode: ['manual', 'reverse'].includes(orderModeRaw) ? orderModeRaw : 'auto',
        orderValue: clampOrderValue(settings?.orderValue, clampOrderValue(base.orderValue, 100)),
        reverseStart: clampReverseStart(settings?.reverseStart, clampReverseStart(base.reverseStart, 9999)),
        preventRecursion: settings?.preventRecursion !== undefined ? Boolean(settings.preventRecursion) : Boolean(base.preventRecursion),
        delayUntilRecursion: settings?.delayUntilRecursion !== undefined ? Boolean(settings.delayUntilRecursion) : Boolean(base.delayUntilRecursion),
        ignoreBudget: settings?.ignoreBudget !== undefined ? Boolean(settings.ignoreBudget) : Boolean(base.ignoreBudget),
    };
}

export function importLegacyStmbSettings(legacySettings) {
    const defaults = createDefaultStmbSettings();
    if (!legacySettings || typeof legacySettings !== 'object') return defaults;

    return {
        ...defaults,
        parity: { ...STMB_PARITY },
        moduleSettings: {
            ...defaults.moduleSettings,
            ...getPotentialModuleSettings(legacySettings),
        },
        titleFormat: typeof legacySettings.titleFormat === 'string' && legacySettings.titleFormat.trim()
            ? legacySettings.titleFormat
            : defaults.titleFormat,
        promptPresets: legacySettings.promptPresets && typeof legacySettings.promptPresets === 'object'
            ? { ...legacySettings.promptPresets }
            : { ...defaults.promptPresets },
        promptPresetMetadata: legacySettings.promptPresetMetadata && typeof legacySettings.promptPresetMetadata === 'object'
            ? { ...legacySettings.promptPresetMetadata }
            : { ...defaults.promptPresetMetadata },
        arcPromptPresets: legacySettings.arcPromptPresets && typeof legacySettings.arcPromptPresets === 'object'
            ? { ...legacySettings.arcPromptPresets }
            : { ...defaults.arcPromptPresets },
        arcPromptPresetMetadata: legacySettings.arcPromptPresetMetadata && typeof legacySettings.arcPromptPresetMetadata === 'object'
            ? { ...legacySettings.arcPromptPresetMetadata }
            : { ...defaults.arcPromptPresetMetadata },
        profiles: Array.isArray(legacySettings.profiles) ? legacySettings.profiles : defaults.profiles,
        defaultProfile: legacySettings.defaultProfile ?? defaults.defaultProfile,
        characterMemoryBookLocks: normalizeCharacterMemoryBookLocks(legacySettings.characterMemoryBookLocks).locks,
        migrationVersion: Number.isFinite(Number(legacySettings.migrationVersion))
            ? Number(legacySettings.migrationVersion)
            : defaults.migrationVersion,
    };
}

export function normalizeStmbSettings(rawSettings, legacySettings = null) {
    const defaults = createDefaultStmbSettings();
    const sourceCandidate = rawSettings && typeof rawSettings === 'object' ? rawSettings : legacySettings;
    const source = rawSettings && typeof rawSettings === 'object' && !rawSettings.moduleSettings
        ? importLegacyStmbSettings(rawSettings)
        : importLegacyStmbSettings(sourceCandidate);
    let migrationVersion = Number.isFinite(Number(source.migrationVersion))
        ? Number(source.migrationVersion)
        : defaults.migrationVersion;

    const moduleSettings = {
        ...defaults.moduleSettings,
        ...getPotentialModuleSettings(source),
    };

    if (moduleSettings.maxTokens === undefined || moduleSettings.maxTokens === null) {
        moduleSettings.maxTokens = defaults.moduleSettings.maxTokens;
    } else {
        const parsedMaxTokens = Number.parseInt(moduleSettings.maxTokens, 10);
        moduleSettings.maxTokens = Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0
            ? parsedMaxTokens
            : defaults.moduleSettings.maxTokens;
    }
    const parsedTokenWarningThreshold = Number(moduleSettings.tokenWarningThreshold);
    moduleSettings.tokenWarningThreshold = Number.isFinite(parsedTokenWarningThreshold) && parsedTokenWarningThreshold >= 1000
        ? Math.trunc(parsedTokenWarningThreshold)
        : defaults.moduleSettings.tokenWarningThreshold;
    moduleSettings.defaultMemoryCount = Number.isFinite(Number(moduleSettings.defaultMemoryCount))
        ? Math.max(0, Math.min(7, Math.trunc(Number(moduleSettings.defaultMemoryCount))))
        : defaults.moduleSettings.defaultMemoryCount;
    moduleSettings.showConsolidationPreviews = Boolean(moduleSettings.showConsolidationPreviews);
    moduleSettings.autoAcceptGroupParticipants = Boolean(moduleSettings.autoAcceptGroupParticipants);
    moduleSettings.unhiddenEntriesCount = moduleSettings.unhiddenEntriesCount === undefined || moduleSettings.unhiddenEntriesCount === null
        ? defaults.moduleSettings.unhiddenEntriesCount
        : moduleSettings.unhiddenEntriesCount;
    moduleSettings.autoSummaryInterval = moduleSettings.autoSummaryInterval === undefined || Number(moduleSettings.autoSummaryInterval) < 10
        ? defaults.moduleSettings.autoSummaryInterval
        : Math.trunc(Number(moduleSettings.autoSummaryInterval));
    moduleSettings.autoSummaryBuffer = Number.isFinite(Number(moduleSettings.autoSummaryBuffer)) ? Math.max(0, Math.trunc(Number(moduleSettings.autoSummaryBuffer))) : defaults.moduleSettings.autoSummaryBuffer;
    moduleSettings.convertExistingRecursion = Boolean(moduleSettings.convertExistingRecursion);
    moduleSettings.sidePromptsMaxConcurrent = Number.isFinite(Number(moduleSettings.sidePromptsMaxConcurrent))
        ? Math.max(1, Math.min(5, Math.trunc(Number(moduleSettings.sidePromptsMaxConcurrent))))
        : defaults.moduleSettings.sidePromptsMaxConcurrent;
    moduleSettings.defaultSoloSidePromptSetKey = typeof moduleSettings.defaultSoloSidePromptSetKey === 'string'
        ? moduleSettings.defaultSoloSidePromptSetKey.trim()
        : defaults.moduleSettings.defaultSoloSidePromptSetKey;
    moduleSettings.defaultGroupSidePromptSetKey = typeof moduleSettings.defaultGroupSidePromptSetKey === 'string'
        ? moduleSettings.defaultGroupSidePromptSetKey.trim()
        : defaults.moduleSettings.defaultGroupSidePromptSetKey;
    moduleSettings.showFloatingClipButton = moduleSettings.showFloatingClipButton !== false;
    moduleSettings.copyMemoryBooksWithChatCopies = moduleSettings.copyMemoryBooksWithChatCopies !== false;
    moduleSettings.memoryBoundaryMode = normalizeStmbMemoryBoundaryMode(moduleSettings.memoryBoundaryMode);
    moduleSettings.memoryBoundaryButtonPosition = normalizeStmbMemoryBoundaryButtonPosition(moduleSettings.memoryBoundaryButtonPosition);
    moduleSettings.chatEndButtonPosition = normalizeStmbMemoryBoundaryButtonPosition(moduleSettings.chatEndButtonPosition);
    moduleSettings.compactionPromptTemplate = typeof moduleSettings.compactionPromptTemplate === 'string'
        && moduleSettings.compactionPromptTemplate.trim()
        && moduleSettings.compactionPromptTemplate.includes('{{ENTRY_CONTENT}}')
        ? moduleSettings.compactionPromptTemplate
        : defaults.moduleSettings.compactionPromptTemplate;
    moduleSettings.topicalClipPromptTemplate = typeof moduleSettings.topicalClipPromptTemplate === 'string'
        && moduleSettings.topicalClipPromptTemplate.trim()
        && moduleSettings.topicalClipPromptTemplate.includes('{{SOURCE_MEMORIES}}')
        ? moduleSettings.topicalClipPromptTemplate
        : defaults.moduleSettings.topicalClipPromptTemplate;
    moduleSettings.autoConsolidationTargetTiers = Array.isArray(moduleSettings.autoConsolidationTargetTiers)
        ? moduleSettings.autoConsolidationTargetTiers.map(value => Number(value)).filter(Number.isFinite)
        : defaults.moduleSettings.autoConsolidationTargetTiers.slice();
    moduleSettings.lorebookOrderDefaults = cloneStloSettings(moduleSettings.lorebookOrderDefaults, { omitDefault: true });
    moduleSettings.selectedRegexOutgoing = Array.isArray(moduleSettings.selectedRegexOutgoing) ? moduleSettings.selectedRegexOutgoing.map(String) : [];
    moduleSettings.selectedRegexIncoming = Array.isArray(moduleSettings.selectedRegexIncoming) ? moduleSettings.selectedRegexIncoming.map(String) : [];
    moduleSettings.defaultArcPromptKey = typeof moduleSettings.defaultArcPromptKey === 'string' && moduleSettings.defaultArcPromptKey.trim()
        ? moduleSettings.defaultArcPromptKey.trim()
        : defaults.moduleSettings.defaultArcPromptKey;
    const legacySummaryOrderMode = moduleSettings.summaryOrderMode ?? moduleSettings.arcOrderMode ?? defaults.moduleSettings.summaryOrderMode;
    const legacySummaryOrderValue = moduleSettings.summaryOrderValue ?? moduleSettings.arcOrderValue ?? defaults.moduleSettings.summaryOrderValue;
    const legacySummaryReverseStart = moduleSettings.summaryReverseStart ?? moduleSettings.arcReverseStart ?? defaults.moduleSettings.summaryReverseStart;
    moduleSettings.summaryEntrySettings = normalizeLorebookEntrySettings({
        ...(moduleSettings.summaryEntrySettings || {}),
        orderMode: moduleSettings.summaryEntrySettings?.orderMode ?? legacySummaryOrderMode,
        orderValue: moduleSettings.summaryEntrySettings?.orderValue ?? legacySummaryOrderValue,
        reverseStart: moduleSettings.summaryEntrySettings?.reverseStart ?? legacySummaryReverseStart,
    }, defaults.moduleSettings.summaryEntrySettings);
    moduleSettings.summaryOrderMode = moduleSettings.summaryEntrySettings.orderMode;
    moduleSettings.summaryOrderValue = moduleSettings.summaryEntrySettings.orderValue;
    moduleSettings.summaryReverseStart = moduleSettings.summaryEntrySettings.reverseStart;
    moduleSettings.arcOrderMode = moduleSettings.summaryOrderMode;
    moduleSettings.arcOrderValue = moduleSettings.summaryOrderValue;
    moduleSettings.arcReverseStart = moduleSettings.summaryReverseStart;
    moduleSettings.summaryTierMinimums = normalizeSummaryTierMinimums(moduleSettings.summaryTierMinimums, defaults.moduleSettings.summaryTierMinimums);
    if (moduleSettings.manualModeEnabled && moduleSettings.autoCreateLorebook) {
        moduleSettings.autoCreateLorebook = false;
    }

    const rawProfiles = Array.isArray(source.profiles) ? source.profiles : [];
    let defaultProfile = Number(source.defaultProfile);
    if (!Number.isFinite(defaultProfile)) defaultProfile = defaults.defaultProfile;
    const titleFormat = typeof source.titleFormat === 'string' && source.titleFormat.trim() ? source.titleFormat : defaults.titleFormat;

    const profileValidation = validateAndFixStmbProfiles({
        profiles: rawProfiles.length > 0 ? rawProfiles : defaults.profiles,
        defaultProfile,
        titleFormat,
    });
    // Profile validation also migrates legacy connection fields to the v5 override shape.
    if (migrationVersion < STMB_SETTINGS_VERSION) {
        migrationVersion = STMB_SETTINGS_VERSION;
    }
    defaultProfile = profileValidation.settings.defaultProfile;
    const parsedCompactionProfileIndex = Number(moduleSettings.compactionProfileIndex);
    moduleSettings.compactionProfileIndex = Number.isFinite(parsedCompactionProfileIndex)
        && parsedCompactionProfileIndex >= 0
        && parsedCompactionProfileIndex < profileValidation.settings.profiles.length
        ? Math.trunc(parsedCompactionProfileIndex)
        : defaultProfile;

    return {
        parity: { ...STMB_PARITY },
        moduleSettings,
        titleFormat,
        promptPresets: source.promptPresets && typeof source.promptPresets === 'object'
            ? { ...source.promptPresets }
            : { ...defaults.promptPresets },
        promptPresetMetadata: source.promptPresetMetadata && typeof source.promptPresetMetadata === 'object'
            ? { ...source.promptPresetMetadata }
            : { ...defaults.promptPresetMetadata },
        arcPromptPresets: source.arcPromptPresets && typeof source.arcPromptPresets === 'object'
            ? { ...source.arcPromptPresets }
            : { ...defaults.arcPromptPresets },
        arcPromptPresetMetadata: source.arcPromptPresetMetadata && typeof source.arcPromptPresetMetadata === 'object'
            ? { ...source.arcPromptPresetMetadata }
            : { ...defaults.arcPromptPresetMetadata },
        profiles: profileValidation.settings.profiles,
        defaultProfile,
        characterMemoryBookLocks: normalizeCharacterMemoryBookLocks(source.characterMemoryBookLocks).locks,
        migrationVersion,
    };
}

/** Resolves the chat override or chat-type default for after-memory side prompts. */
export function resolveAfterMemorySidePromptSetKey(chatState = {}, moduleSettings = {}, isGroupChat = false) {
    const state = chatState && typeof chatState === 'object' ? chatState : {};
    if (Object.hasOwn(state, 'sidePromptAfterMemorySetKey')) {
        return String(state.sidePromptAfterMemorySetKey || '').trim();
    }

    const defaultKey = isGroupChat
        ? moduleSettings?.defaultGroupSidePromptSetKey
        : moduleSettings?.defaultSoloSidePromptSetKey;
    return String(defaultKey || '').trim();
}

export function getActiveStmbProfile(settings, profileIndex = null) {
    const normalized = normalizeStmbSettings(settings);
    const index = profileIndex === null ? normalized.defaultProfile : Number(profileIndex);
    return normalized.profiles[index] || normalized.profiles[normalized.defaultProfile] || createDefaultStmbProfile();
}

function normalizeCompletionSource(source) {
    const normalized = String(source || '').trim().toLowerCase();
    if (normalized === 'google') return 'makersuite';
    return normalized || 'openai';
}

function isOpenAIReasoningModel(modelId) {
    return /^(o1|o3|o4)/i.test(String(modelId || '').trim());
}

function usesOpenAIMaxCompletionTokens(modelId) {
    return isOpenAIReasoningModel(modelId) || /^(gpt-5|gpt-4o)/i.test(String(modelId || '').trim());
}

function isOpenAICompatibleStmbRequest(provider, originalApi = '') {
    return provider === 'openai' || provider === 'azure_openai' || originalApi === 'full-manual';
}

export function normalizeNavyReasoningEffort(value) {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case '':
        case 'auto':
            return undefined;
        case 'min':
        case 'minimum':
            return 'minimal';
        case 'max':
        case 'maximum':
            return 'xhigh';
        case 'none':
        case 'minimal':
        case 'low':
        case 'medium':
        case 'high':
        case 'xhigh':
            return normalized;
        default:
            return undefined;
    }
}

export function resolveStmbProfileConnection(profile) {
    const connection = profile?.connection && typeof profile.connection === 'object' ? profile.connection : {};
    const api = normalizeCompletionSource(connection.api || 'openai');
    const model = typeof connection.model === 'string' ? connection.model.trim() : '';
    const temperatureRaw = Number(connection.temperature);
    const temperature = Number.isFinite(temperatureRaw)
        ? Math.max(0, Math.min(2, temperatureRaw))
        : 0.7;
    const endpoint = typeof connection.endpoint === 'string' && connection.endpoint.trim()
        ? connection.endpoint.trim()
        : '';
    const apiKey = typeof connection.apiKey === 'string' && connection.apiKey.trim()
        ? connection.apiKey.trim()
        : '';

    return {
        api,
        model,
        temperature,
        endpoint,
        apiKey,
        useCurrentStSettings: Boolean(profile?.useDynamicSTSettings) || api === 'current_st',
    };
}

export function getStmbConnectionProfileApiKeyError(profile, options = {}) {
    const connection = resolveStmbProfileConnection(profile);
    const hasStoredApiKey = Boolean(options.hasStoredApiKey);
    if (connection.useCurrentStSettings || connection.api === 'full-manual') {
        return '';
    }

    return hasStoredApiKey ? '' : STMB_CONNECTION_PROFILE_API_KEY_ERROR;
}

export function applyStmbProfileToGenerateData(generateData, profile, providerDefaults = {}) {
    if (!generateData || typeof generateData !== 'object' || !profile || typeof profile !== 'object') {
        return generateData;
    }

    const connection = resolveStmbProfileConnection(profile);
    if (connection.useCurrentStSettings) {
        return generateData;
    }
    if (!connection.model) {
        throw new Error('STMB profile is missing required connection.model');
    }
    if (connection.api === 'full-manual' && !connection.endpoint) {
        throw new Error('STMB full-manual profile is missing required connection.endpoint');
    }

    const next = { ...generateData };
    const originalApi = connection.api;
    const provider = originalApi === 'full-manual' ? 'custom' : originalApi;
    next.chat_completion_source = provider;
    if (originalApi === 'full-manual') {
        Object.defineProperty(next, STMB_OPENAI_COMPAT_GENERATE_DATA, {
            value: true,
            enumerable: false,
        });
    }

    if (connection.model) {
        next.model = connection.model;
    }
    if (Number.isFinite(connection.temperature)) {
        next.temperature = connection.temperature;
    }

    if (connection.endpoint) {
        if (provider === 'custom') {
            next.custom_url = connection.endpoint;
        } else if (provider === 'azure_openai') {
            next.azure_base_url = connection.endpoint;
            next.azure_deployment_name = connection.model || providerDefaults.azure_deployment_name || next.azure_deployment_name;
        } else if (STMB_REVERSE_PROXY_PROFILE_APIS.has(provider)) {
            next.reverse_proxy = connection.endpoint;
        }
    }

    if (connection.apiKey && originalApi === 'full-manual') {
        next.custom_api_key = connection.apiKey;
    }

    if (provider === 'azure_openai') {
        if (!next.azure_base_url && providerDefaults.azure_base_url) {
            next.azure_base_url = providerDefaults.azure_base_url;
        }
        if (!next.azure_api_version && providerDefaults.azure_api_version) {
            next.azure_api_version = providerDefaults.azure_api_version;
        }
        if (!next.azure_deployment_name && (providerDefaults.azure_deployment_name || connection.model)) {
            next.azure_deployment_name = providerDefaults.azure_deployment_name || connection.model;
        }
    }

    if (provider === 'custom' && originalApi !== 'full-manual' && !next.custom_url && providerDefaults.custom_url) {
        next.custom_url = providerDefaults.custom_url;
    }

    const model = String(next.model || '');
    const isOpenAICompat = isOpenAICompatibleStmbRequest(provider, originalApi);
    const isReasoningModel = isOpenAICompat && isOpenAIReasoningModel(model);
    const isGpt5Model = isOpenAICompat && /^gpt-5/i.test(model);

    if (!isOpenAICompat) {
        if (next.max_tokens === undefined && next.max_completion_tokens !== undefined) {
            next.max_tokens = next.max_completion_tokens;
        }
        delete next.max_completion_tokens;
    }

    if (isReasoningModel || isGpt5Model) {
        if (next.max_completion_tokens === undefined && next.max_tokens !== undefined) {
            next.max_completion_tokens = next.max_tokens;
        }
        delete next.max_tokens;
        delete next.logprobs;
        delete next.top_logprobs;
    }

    if (isReasoningModel) {
        delete next.stop;
        delete next.logit_bias;
        delete next.temperature;
        delete next.top_p;
        delete next.frequency_penalty;
        delete next.presence_penalty;
        if (model.startsWith('o1')) {
            delete next.n;
            delete next.tools;
            delete next.tool_choice;
        }
    } else if (isGpt5Model) {
        if (/gpt-5-chat-latest/.test(model)) {
            delete next.tools;
            delete next.tool_choice;
        } else if (/gpt-5\.1/.test(model) && !/chat-latest/.test(model)) {
            delete next.frequency_penalty;
            delete next.presence_penalty;
            delete next.logit_bias;
            delete next.stop;
        } else {
            delete next.temperature;
            delete next.top_p;
            delete next.frequency_penalty;
            delete next.presence_penalty;
            delete next.logit_bias;
            delete next.stop;
        }
    }

    if (provider === 'navy') {
        const reasoningEffort = normalizeNavyReasoningEffort(next.reasoning_effort);
        if (reasoningEffort) {
            next.reasoning_effort = reasoningEffort;
        } else {
            delete next.reasoning_effort;
        }
    }

    return next;
}

/**
 * Applies an STMB profile's central, current-ST, or legacy connection to request data.
 */
export function applyStmbProfileConnection(generateData, profile, options = {}) {
    const {
        applyConnectionProfileSnapshot,
        createConnectionProfileRequestSnapshot,
        providerDefaults = {},
        translate = text => text,
    } = options;
    const overrides = {
        model: profile?.modelOverride,
        temperature: profile?.temperatureOverride,
    };
    const requestData = {
        ...generateData,
        stream: Boolean(profile?.streaming),
    };

    if (profile?.connectionSnapshot || profile?.connectionProfileId) {
        if (typeof applyConnectionProfileSnapshot !== 'function') {
            throw new TypeError('applyConnectionProfileSnapshot is required for an STMB connection profile');
        }
        const snapshot = profile.connectionSnapshot
            || createConnectionProfileRequestSnapshot?.(profile.connectionProfileId, overrides);
        return applyConnectionProfileSnapshot(requestData, snapshot, overrides);
    }

    if (String(profile?.connection?.api || '') === 'current_st') {
        const model = String(profile?.modelOverride || generateData?.model || '').trim();
        if (!model) {
            throw new Error(translate('Enter a model ID or select a connection profile with a saved model ID.'));
        }
        return {
            ...requestData,
            model,
            temperature: profile?.temperatureOverride !== null && profile?.temperatureOverride !== undefined
                ? profile.temperatureOverride
                : generateData.temperature,
        };
    }

    const legacyProfile = {
        ...profile,
        connection: {
            ...(profile?.connection || {}),
            model: String(profile?.modelOverride || profile?.connection?.model || '').trim(),
            temperature: profile?.temperatureOverride !== null && profile?.temperatureOverride !== undefined
                ? profile.temperatureOverride
                : profile?.connection?.temperature,
        },
    };
    return applyStmbProfileToGenerateData(requestData, legacyProfile, providerDefaults);
}

export function applyStmbMaxTokensToGenerateData(generateData, stmbMaxTokens) {
    if (!generateData || typeof generateData !== 'object') {
        return generateData;
    }

    const parsedMaxTokens = Number.parseInt(stmbMaxTokens, 10);
    if (!Number.isFinite(parsedMaxTokens) || parsedMaxTokens <= 0) {
        return generateData;
    }

    const next = { ...generateData };
    const provider = String(next.chat_completion_source || '').toLowerCase();
    const modelId = String(next.model || '').toLowerCase();
    const usesMaxCompletionTokens = (
        isOpenAICompatibleStmbRequest(provider)
        || Boolean(generateData[STMB_OPENAI_COMPAT_GENERATE_DATA])
    )
        && usesOpenAIMaxCompletionTokens(modelId);

    if (usesMaxCompletionTokens) {
        next.max_completion_tokens = parsedMaxTokens;
        delete next.max_tokens;
    } else {
        next.max_tokens = parsedMaxTokens;
        delete next.max_completion_tokens;
    }

    if (next.max_output_tokens != null) {
        const parsedOutputTokens = Number.parseFloat(next.max_output_tokens);
        const normalizedOutputTokens = Number.isFinite(parsedOutputTokens) ? Math.floor(parsedOutputTokens) : 0;
        next.max_output_tokens = Math.min(normalizedOutputTokens, parsedMaxTokens);
    }

    return next;
}

/**
 * Converts an avatar filename into the stable name used by world-info character filters.
 * @param {unknown} avatar Avatar filename or identifier.
 * @returns {string}
 */
export function getStmbCharacterFilterName(avatar) {
    const value = String(avatar || '').trim();
    if (!value) return '';
    const withoutQuery = value.split(/[?#]/, 1)[0];
    const basename = withoutQuery.split(/[\\/]/).at(-1) || '';
    return basename.replace(/\.[^/.]+$/, '');
}

/**
 * Normalizes a list of world-info character filter names without changing order.
 * @param {unknown} value Candidate list.
 * @returns {string[]}
 */
export function normalizeStmbCharacterFilterNames(value) {
    const result = [];
    const seen = new Set();
    for (const item of Array.isArray(value) ? value : []) {
        const name = String(item || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push(name);
    }
    return result;
}

/**
 * Builds a participant resolver from a serializable group-member snapshot.
 * @param {unknown} participants Group participant descriptors.
 * @returns {{members: object[], memberAvatars: Set<string>, avatarsBySpeaker: Map<string, Set<string>>}|null}
 */
export function createStmbGroupParticipantResolver(participants) {
    if (!Array.isArray(participants) || participants.length === 0) return null;

    const members = [];
    const memberAvatars = new Set();
    const avatarsBySpeaker = new Map();
    const seenKeys = new Set();
    for (const item of participants) {
        const avatar = String(item?.avatar || item?.memberId || item?.key || '').trim();
        const key = String(item?.key || avatar).trim();
        if (!avatar || !key || seenKeys.has(key)) continue;

        const name = String(item?.name || item?.speakerName || key).trim() || key;
        const characterFilterName = String(item?.characterFilterName || getStmbCharacterFilterName(avatar)).trim();
        if (!characterFilterName) continue;

        const member = {
            key,
            avatar,
            memberId: String(item?.memberId || avatar).trim() || avatar,
            name,
            characterFilterName,
        };
        members.push(member);
        seenKeys.add(key);
        memberAvatars.add(avatar);
        if (name) {
            if (!avatarsBySpeaker.has(name)) avatarsBySpeaker.set(name, new Set());
            avatarsBySpeaker.get(name).add(avatar);
        }
    }

    return members.length > 0 ? { members, memberAvatars, avatarsBySpeaker } : null;
}

/**
 * Resolves a group message to a world-info character filter name.
 * @param {object} message Chat message.
 * @param {ReturnType<typeof createStmbGroupParticipantResolver>} resolver Participant resolver.
 * @returns {string}
 */
export function resolveStmbGroupParticipantFilterName(message, resolver) {
    if (!resolver) return '';
    const originalAvatar = String(message?.original_avatar || '').trim();
    if (originalAvatar && resolver.memberAvatars.has(originalAvatar)) {
        return getStmbCharacterFilterName(originalAvatar);
    }

    const speakerName = String(message?.name || '').trim();
    const matches = speakerName ? resolver.avatarsBySpeaker.get(speakerName) : null;
    return matches?.size === 1 ? getStmbCharacterFilterName(matches.values().next().value) : '';
}

/**
 * Counts hidden and visible messages in a selected scene without changing them.
 * @param {object[]} messages Chat messages.
 * @param {number} sceneStart Inclusive scene start index.
 * @param {number} sceneEnd Inclusive scene end index.
 * @returns {{totalMessageCount:number, hiddenMessageCount:number, visibleMessageCount:number}}
 */
export function getSceneMessageVisibilityStats(messages, sceneStart, sceneEnd) {
    const stats = { totalMessageCount: 0, hiddenMessageCount: 0, visibleMessageCount: 0 };
    if (!Array.isArray(messages) || !Number.isInteger(sceneStart) || !Number.isInteger(sceneEnd) || sceneStart > sceneEnd) {
        return stats;
    }

    for (let index = Math.max(0, sceneStart); index <= sceneEnd && index < messages.length; index++) {
        const message = messages[index];
        if (!message) continue;

        stats.totalMessageCount++;
        if (message.is_system) {
            stats.hiddenMessageCount++;
        } else {
            stats.visibleMessageCount++;
        }
    }

    return stats;
}

export function compileScene(messages, sceneRequest, options = {}) {
    const sourceMessages = Array.isArray(messages) ? messages : [];
    const sceneStart = Number(sceneRequest?.sceneStart);
    const sceneEnd = Number(sceneRequest?.sceneEnd);
    const skipSystemMessages = options?.skipSystemMessages !== false;
    const groupParticipantResolver = createStmbGroupParticipantResolver(options?.groupParticipants);

    if (!Number.isInteger(sceneStart) || !Number.isInteger(sceneEnd)) {
        throw new Error('Scene markers are required');
    }
    if (sceneStart > sceneEnd) {
        throw new Error('Start message cannot be greater than end message');
    }
    if (sceneStart < 0 || sceneEnd >= sourceMessages.length) {
        throw new Error(`Message IDs out of bounds: ${sceneStart}-${sceneEnd} (0-${Math.max(sourceMessages.length - 1, 0)})`);
    }

    const sceneMessages = [];
    const participantFilterNames = new Set();
    let hiddenMessageCount = 0;
    let skippedMessageCount = 0;

    for (let index = sceneStart; index <= sceneEnd; index++) {
        const message = sourceMessages[index];
        if (!message) {
            skippedMessageCount++;
            continue;
        }
        if (skipSystemMessages && message.is_system) {
            hiddenMessageCount++;
            continue;
        }

        const content = String(message.mes || '').replace(/\r\n/g, '\n').trim();
        if (!content) {
            skippedMessageCount++;
            continue;
        }

        const compiledMessage = {
            id: index,
            name: String(message.name || '').trim() || 'Unknown',
            mes: content,
            send_date: message.send_date || new Date().toISOString(),
            is_user: Boolean(message.is_user),
        };
        if (!message.is_user && typeof message.original_avatar === 'string' && message.original_avatar.trim()) {
            compiledMessage.original_avatar = message.original_avatar.trim();
        }
        if (!message.is_user && groupParticipantResolver) {
            const filterName = resolveStmbGroupParticipantFilterName(message, groupParticipantResolver);
            if (filterName) participantFilterNames.add(filterName);
        }
        sceneMessages.push(compiledMessage);
    }

    if (sceneMessages.length === 0) {
        throw new Error(`No visible messages in range ${sceneStart}-${sceneEnd}`);
    }

    const metadata = {
        sceneStart,
        sceneEnd,
        messageCount: sceneMessages.length,
        totalRequestedRange: sceneEnd - sceneStart + 1,
        hiddenMessagesSkipped: hiddenMessageCount,
        messagesSkipped: skippedMessageCount,
        compiledAt: new Date().toISOString(),
        totalChatLength: sourceMessages.length,
        chatId: String(sceneRequest?.chatId || ''),
        characterName: String(sceneRequest?.characterName || ''),
        userName: String(sceneRequest?.userName || ''),
        groupName: String(sceneRequest?.groupName || ''),
        stmbPromptTarget: String(sceneRequest?.stmbPromptTarget || ''),
    };
    if (participantFilterNames.size > 0) {
        metadata.characterFilterNames = Array.from(participantFilterNames);
    }

    return {
        metadata,
        messages: sceneMessages,
    };
}

export function compiledSceneToText(compiledScene) {
    const metadata = compiledScene?.metadata || {};
    const messages = Array.isArray(compiledScene?.messages) ? compiledScene.messages : [];
    const output = [];
    output.push('=== SCENE METADATA ===');
    output.push(`Range: ${metadata.sceneStart}-${metadata.sceneEnd}`);
    output.push(`Chat: ${metadata.chatId || 'unknown'}`);
    output.push(`Character: ${metadata.characterName || 'Unknown'}`);
    output.push(`User: ${metadata.userName || 'User'}`);
    output.push(`Visible messages: ${messages.length}`);
    output.push('');
    output.push('=== SCENE MESSAGES ===');
    for (const message of messages) {
        output.push(`[${message.id}] ${message.name}: ${message.mes}`);
    }
    return output.join('\n');
}

export function parseSceneRange(value) {
    if (typeof value !== 'string') {
        throw new Error('Scene range is required');
    }

    const match = value.trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (!match) {
        throw new Error('Scene range must be in x-y format');
    }

    return {
        sceneStart: Number(match[1]),
        sceneEnd: Number(match[2]),
    };
}

export function parseSceneMemoryCommandRange(rangeText, chatEntries = []) {
    const rangeValue = String(rangeText || '').trim();
    if (!rangeValue) {
        throw new Error('Missing range argument. Use: /scenememory X-Y (e.g., /scenememory 10-15)');
    }

    const match = rangeValue.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (!match) {
        throw new Error('Invalid format. Use: /scenememory X-Y (e.g., /scenememory 10-15)');
    }

    const startId = Number(match[1]);
    const endId = Number(match[2]);
    if (!Number.isFinite(startId) || !Number.isFinite(endId)) {
        throw new Error('Invalid message IDs parsed. Use: /scenememory X-Y (e.g., /scenememory 10-15)');
    }

    if (startId > endId) {
        throw new Error('Start message cannot be greater than end message');
    }

    const activeChat = Array.isArray(chatEntries) ? chatEntries : [];
    if (startId < 0 || endId >= activeChat.length) {
        throw new Error(`Message IDs out of range. Valid range: 0-${activeChat.length - 1}`);
    }

    if (!activeChat[startId] || !activeChat[endId]) {
        throw new Error('One or more specified messages do not exist');
    }

    return {
        sceneStart: startId,
        sceneEnd: endId,
    };
}

function parseRequiredIntegerArgument(rawValue, name) {
    const value = rawValue && typeof rawValue === 'object' && 'value' in rawValue
        ? rawValue.value
        : rawValue;
    if (value === undefined || value === null || value === '') {
        throw new Error(`Missing or invalid ${name}. Use: /stmb-catchup interval=<chunk size> start=<message id> end=<message id>`);
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new Error(`Missing or invalid ${name}. Use: /stmb-catchup interval=<chunk size> start=<message id> end=<message id>`);
    }

    return parsed;
}

export function parseStmbCatchupCommandArgs(namedArgs = {}) {
    return {
        interval: parseRequiredIntegerArgument(namedArgs?.interval, 'interval'),
        start: parseRequiredIntegerArgument(namedArgs?.start, 'start'),
        end: parseRequiredIntegerArgument(namedArgs?.end, 'end'),
    };
}

export function buildStmbCatchupChunks({ interval, start, end, lastAvailableMessageId, missingRanges = [] } = {}) {
    const normalizedInterval = Number(interval);
    const normalizedStart = Number(start);
    const normalizedEnd = Number(end);
    const normalizedLast = Number(lastAvailableMessageId);

    if (!Number.isInteger(normalizedInterval) || normalizedInterval <= 0) {
        throw new Error('Interval must be a positive whole number.');
    }
    if (!Number.isInteger(normalizedLast) || normalizedLast < 0) {
        throw new Error('There are no messages in this chat yet.');
    }
    if (!Number.isInteger(normalizedStart) || !Number.isInteger(normalizedEnd) || normalizedStart < 0 || normalizedEnd < 0 || normalizedStart > normalizedLast || normalizedEnd > normalizedLast) {
        throw new Error(`Message IDs out of range. Valid range: 0-${normalizedLast}`);
    }
    if (normalizedStart > normalizedEnd) {
        throw new Error('Start message cannot be greater than end message');
    }
    if (Array.isArray(missingRanges) && missingRanges.length > 0) {
        const missing = missingRanges[0];
        throw new Error(`Cannot run /stmb-catchup because messages ${missing.start}-${missing.end} are unavailable in chat storage.`);
    }

    const chunks = [];
    for (let sceneStart = normalizedStart; sceneStart <= normalizedEnd; sceneStart += normalizedInterval) {
        chunks.push({
            sceneStart,
            sceneEnd: Math.min(sceneStart + normalizedInterval - 1, normalizedEnd),
        });
    }

    return chunks;
}

export function readSidePromptCheckpoint(templateKey, existingEntry, { includeLegacyScore = false } = {}) {
    const scopedLastMsgId = existingEntry?.[`STMB_sp_${templateKey}_lastMsgId`];
    const trackerLastMsgId = existingEntry?.STMB_tracker_lastMsgId;
    const legacyScoreLastMsgId = includeLegacyScore ? existingEntry?.STMB_score_lastMsgId : undefined;
    const lastMsgIdValue = scopedLastMsgId ?? legacyScoreLastMsgId ?? trackerLastMsgId;
    const parsedLastMsgId = Number(lastMsgIdValue);

    const scopedLastRunAt = existingEntry?.[`STMB_sp_${templateKey}_lastRunAt`];
    const trackerLastRunAt = existingEntry?.STMB_tracker_lastRunAt;
    const parsedLastRunAt = scopedLastRunAt ? Date.parse(scopedLastRunAt) : (trackerLastRunAt ? Date.parse(trackerLastRunAt) : NaN);

    return {
        lastMsgId: Number.isFinite(parsedLastMsgId) ? Math.trunc(parsedLastMsgId) : -1,
        lastRunAt: Number.isFinite(parsedLastRunAt) ? parsedLastRunAt : null,
    };
}

export function buildSidePromptCheckpointMetadata(templateKey, {
    lastMsgId = null,
    lastRunAt = '',
    includeLastMsgId = true,
    includeTrackerFallback = true,
} = {}) {
    const key = String(templateKey || '').trim();
    const normalizedLastRunAt = String(lastRunAt || '').trim();
    const normalizedLastMsgId = Number.isFinite(Number(lastMsgId)) ? Math.trunc(Number(lastMsgId)) : null;
    const metadata = {};

    if (!key) {
        return metadata;
    }

    if (includeLastMsgId && normalizedLastMsgId !== null) {
        metadata[`STMB_sp_${key}_lastMsgId`] = normalizedLastMsgId;
        if (includeTrackerFallback) {
            metadata.STMB_tracker_lastMsgId = normalizedLastMsgId;
        }
    }

    if (normalizedLastRunAt) {
        metadata[`STMB_sp_${key}_lastRunAt`] = normalizedLastRunAt;
        if (includeTrackerFallback) {
            metadata.STMB_tracker_lastRunAt = normalizedLastRunAt;
        }
    }

    return metadata;
}

function normalizeText(text) {
    return String(text ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/^\uFEFF/, '')
        .replace(/[\u0000-\u001F\u200B-\u200D\u2060]/g, '');
}

function extractFenceContent(text) {
    const matches = [...String(text || '').matchAll(/```(?:[\w-]+)?\s*([\s\S]*?)```/g)];
    return matches.map(match => String(match[1] || '').trim()).filter(Boolean);
}

function extractFromClaudeStructuredFormat(aiResponse) {
    if (typeof aiResponse !== 'object' || aiResponse === null || !Array.isArray(aiResponse.content)) {
        return null;
    }

    const textBlock = aiResponse.content.find(block =>
        block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string',
    );
    return textBlock?.text || null;
}

function extractGeminiText(aiResponse) {
    const parts = aiResponse?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;

    const text = parts.map(part => typeof part?.text === 'string' ? part.text : '').join('');
    return text.trim() || null;
}

function extractBalancedJson(text) {
    const source = String(text || '');
    const start = source.search(/[{\[]/);
    if (start < 0) return null;

    const stack = [];
    let inString = false;
    let escaping = false;
    for (let index = start; index < source.length; index++) {
        const character = source[index];
        if (inString) {
            if (escaping) escaping = false;
            else if (character === '\\') escaping = true;
            else if (character === '"') inString = false;
            continue;
        }

        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === '{' || character === '[') {
            stack.push(character);
            continue;
        }
        if (character === '}' || character === ']') {
            const open = stack.pop();
            if (!open) return null;
            if ((open === '{' && character !== '}') || (open === '[' && character !== ']')) return null;
            if (stack.length === 0) return source.slice(start, index + 1).trim();
        }
    }

    return null;
}

function likelyUnbalanced(raw) {
    let braces = 0;
    let brackets = 0;
    let inString = false;
    let escaping = false;

    for (const character of String(raw || '')) {
        if (inString) {
            if (escaping) escaping = false;
            else if (character === '\\') escaping = true;
            else if (character === '"') inString = false;
            continue;
        }

        if (character === '"') inString = true;
        else if (character === '{') braces++;
        else if (character === '}') braces--;
        else if (character === '[') brackets++;
        else if (character === ']') brackets--;

        if (braces < 0 || brackets < 0) return true;
    }

    return inString || braces !== 0 || brackets !== 0;
}

function endsNicely(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return true;
    if (/[.!?]["'’)\]]?$/.test(trimmed)) return true;
    return trimmed.length < 80;
}

function tryLooseJsonParse(candidate) {
    const repairs = [
        candidate,
        candidate.replace(/,\s*([}\]])/g, '$1'),
        candidate.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3'),
        candidate
            .replace(/,\s*([}\]])/g, '$1')
            .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3'),
    ];

    for (const repaired of repairs) {
        try {
            return JSON.parse(repaired);
        } catch {
            // Keep trying.
        }
    }

    return null;
}

function normalizeKeywords(keywords) {
    if (!Array.isArray(keywords)) return [];
    return keywords.map(keyword => String(keyword || '').trim()).filter(Boolean);
}

function makeParseError(code, message, rawResponse, recoverable = false) {
    return new StmbStructuredParseError(code, message, {
        rawResponse: typeof rawResponse === 'string' ? rawResponse : '',
        recoverable,
    });
}

export function validateMemoryObject(memoryObject, rawResponse = '') {
    if (!memoryObject || typeof memoryObject !== 'object' || Array.isArray(memoryObject)) {
        throw makeParseError('EMPTY_OR_INVALID', 'AI response is empty or invalid', rawResponse);
    }

    const title = String(memoryObject.title || '').trim();
    const content = String(memoryObject.content || memoryObject.summary || memoryObject.memory_content || '').trim();
    const keywords = normalizeKeywords(memoryObject.keywords);

    if (!content) throw makeParseError('MISSING_FIELDS_CONTENT', 'AI response missing content field', rawResponse);
    if (!title) throw makeParseError('MISSING_FIELDS_TITLE', 'AI response missing title field', rawResponse);
    if (!Array.isArray(memoryObject.keywords) || keywords.length === 0) {
        throw makeParseError('INVALID_KEYWORDS', 'AI response missing or invalid keywords array.', rawResponse);
    }

    return { title, content, keywords };
}

export function parseStructuredMemoryResponse(responseText) {
    let cleanResponse = responseText;

    if (cleanResponse && typeof cleanResponse === 'object' && !Array.isArray(cleanResponse)) {
        const directTitle = typeof cleanResponse.title === 'string';
        const directContent = typeof cleanResponse.content === 'string' || typeof cleanResponse.summary === 'string' || typeof cleanResponse.memory_content === 'string';
        if (directTitle || directContent || Array.isArray(cleanResponse.keywords)) {
            return validateMemoryObject(cleanResponse, JSON.stringify(cleanResponse));
        }
    }

    if (cleanResponse && typeof cleanResponse === 'object' && Array.isArray(cleanResponse?.choices)) {
        const firstChoice = cleanResponse.choices[0];
        const messageContent = firstChoice?.message?.content;
        if (Array.isArray(messageContent)) {
            const joinedText = messageContent.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim();
            if (joinedText) {
                cleanResponse = joinedText;
            }
        } else if (typeof messageContent === 'string') {
            cleanResponse = messageContent;
        } else if (typeof firstChoice?.text === 'string') {
            cleanResponse = firstChoice.text;
        }
    }

    if (typeof cleanResponse === 'object' && cleanResponse !== null && Array.isArray(cleanResponse.content)) {
        const toolUseInput = cleanResponse.content.find(block =>
            block && typeof block === 'object' && block.type === 'tool_use' && block.input && typeof block.input === 'object',
        )?.input;
        if (toolUseInput) {
            return validateMemoryObject(toolUseInput, JSON.stringify(toolUseInput));
        }
        cleanResponse = extractFromClaudeStructuredFormat(cleanResponse);
    } else if (typeof cleanResponse === 'object' && cleanResponse !== null && typeof cleanResponse.content === 'string') {
        cleanResponse = cleanResponse.content;
    } else if (typeof cleanResponse === 'object' && cleanResponse !== null) {
        const geminiText = extractGeminiText(cleanResponse);
        if (geminiText) cleanResponse = geminiText;
    }

    if (typeof cleanResponse !== 'string') {
        throw makeParseError('EMPTY_OR_INVALID', 'AI response is empty or invalid', '');
    }

    const normalized = normalizeText(cleanResponse).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!normalized) {
        throw makeParseError('EMPTY_OR_INVALID', 'AI response is empty or invalid', '');
    }

    const candidates = [];
    candidates.push(...extractFenceContent(normalized));
    candidates.push(normalized);

    const balanced = extractBalancedJson(normalized);
    if (balanced) candidates.push(balanced);

    let lastValidationError = null;
    for (const candidate of [...new Set(candidates.map(value => String(value || '').trim()).filter(Boolean))]) {
        try {
            return validateMemoryObject(JSON.parse(candidate), normalized);
        } catch (error) {
            if (error instanceof StmbStructuredParseError) {
                lastValidationError = error;
                continue;
            }
        }

        const repaired = tryLooseJsonParse(candidate);
        if (repaired) {
            try {
                return validateMemoryObject(repaired, normalized);
            } catch (error) {
                if (error instanceof StmbStructuredParseError) lastValidationError = error;
            }
        }
    }

    if (!/[{\[]/.test(normalized)) {
        throw makeParseError('NO_JSON_BLOCK', 'AI response did not contain a JSON block. The model may have returned prose or declined the request.', normalized, true);
    }
    if (likelyUnbalanced(normalized)) {
        throw makeParseError('UNBALANCED', 'AI response appears truncated or invalid JSON (unbalanced structures). Try increasing Max Response Length.', normalized);
    }
    if (!endsNicely(normalized)) {
        throw makeParseError('INCOMPLETE_SENTENCE', 'AI response JSON appears incomplete (text ends mid-sentence). Try increasing Max Response Length.', normalized);
    }
    if (lastValidationError) {
        throw lastValidationError;
    }

    throw makeParseError('MALFORMED', 'AI did not return valid JSON. This may indicate the model does not support structured output well or the response contained unsupported formatting.', normalized);
}

export function parseSequenceFromTitle(title) {
    const text = String(title || '');
    const patterns = [
        /\[\[(\d+)\]\]/,
        /\(\[(\d+)\]\)/,
        /\{\[(\d+)\]\}/,
        /#\[(\d+)\]/,
        /\[(\d+)\]/,
        /\((\d+)\)/,
        /\{(\d+)\}/,
        /#(\d+)(?:-(\d+))?/,
        /^(\d+)(?:\s*[-\s])/,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const value = match[2] ?? match[1];
        const sequence = Number(value);
        if (Number.isFinite(sequence)) return sequence;
    }

    for (const match of text.matchAll(/(\d+)/g)) {
        const sequence = Number(match[1]);
        if (!Number.isFinite(sequence)) continue;

        const fullMatch = match[0];
        const index = match.index ?? 0;
        const before = text.substring(Math.max(0, index - 10), index);
        const after = text.substring(index + fullMatch.length, index + fullMatch.length + 10);
        const isDateComponent = /\d{4}-\d{2}-\d{2}/.test(before + fullMatch + after)
            || /\d{4}-\d{1,2}/.test(before + fullMatch)
            || /-\d{1,2}-\d{1,2}/.test(fullMatch + after);

        if (!isDateComponent) return sequence;
    }

    return null;
}

export function identifyManagedMemoryEntries(entries) {
    return Object.values(entries || {})
        .filter(entry =>
            entry &&
            entry[STMB_MANAGED_FLAG] === true,
        )
        .sort((left, right) => {
            const leftSequence = parseSequenceFromTitle(left.comment || left.title || '') ?? Number(left.uid) ?? 0;
            const rightSequence = parseSequenceFromTitle(right.comment || right.title || '') ?? Number(right.uid) ?? 0;
            return leftSequence - rightSequence;
        });
}

function countEntryKeywords(entry) {
    return Array.isArray(entry?.key) ? entry.key.length : 0;
}

export function calculateLorebookStats(lorebookName, lorebookData) {
    const entries = Object.values(lorebookData?.entries || {});
    const managedEntries = identifyManagedMemoryEntries(lorebookData?.entries || {});
    const managedEntrySet = new Set(managedEntries);
    const otherEntries = entries.filter(entry => !managedEntrySet.has(entry));

    return {
        valid: true,
        lorebookName,
        totalEntries: entries.length,
        memoryEntries: managedEntries.length,
        otherEntries: otherEntries.length,
        averageContentLength: entries.length > 0
            ? Math.round(entries.reduce((sum, entry) => sum + (entry?.content?.length || 0), 0) / entries.length)
            : 0,
        totalKeywords: entries.reduce((sum, entry) => sum + countEntryKeywords(entry), 0),
        memoryKeywords: managedEntries.reduce((sum, entry) => sum + countEntryKeywords(entry), 0),
    };
}

export function getRangeFromManagedMemoryEntry(entry) {
    if (typeof entry?.STMB_start === 'number' && typeof entry?.STMB_end === 'number') {
        return { start: entry.STMB_start, end: entry.STMB_end };
    }
    return null;
}

export function findOverlappingManagedMemoryEntry(entries, range) {
    const newStart = Number(range?.sceneStart);
    const newEnd = Number(range?.sceneEnd);
    if (!Number.isInteger(newStart) || !Number.isInteger(newEnd)) {
        return null;
    }

    const managedEntries = Object.values(entries || {})
        .filter(entry => entry && entry[STMB_MANAGED_FLAG] === true)
        .sort((left, right) => {
            const leftSequence = parseSequenceFromTitle(left?.comment || left?.title || '') ?? Number(left?.uid) ?? 0;
            const rightSequence = parseSequenceFromTitle(right?.comment || right?.title || '') ?? Number(right?.uid) ?? 0;
            return leftSequence - rightSequence;
        });

    for (const entry of managedEntries) {
        const existingRange = getRangeFromManagedMemoryEntry(entry);
        if (!existingRange) {
            continue;
        }

        const start = Number(existingRange.start);
        const end = Number(existingRange.end);
        if (!Number.isInteger(start) || !Number.isInteger(end)) {
            continue;
        }

        console.debug(
            `STMemoryBooks: OverlapCheck new=[${newStart}-${newEnd}] existing="${String(entry?.comment || entry?.title || 'Untitled Memory')}" [${start}-${end}] cond1(ns<=e)=${newStart <= end} cond2(ne>=s)=${newEnd >= start}`,
        );

        if (newStart <= end && newEnd >= start) {
            return {
                entry,
                title: String(entry?.comment || entry?.title || 'Untitled Memory'),
                range: { start, end },
            };
        }
    }

    return null;
}

export function applyDeletedMessageToSceneState(state = {}, deletedId, chatLength) {
    const id = Number(deletedId);
    if (!Number.isFinite(id)) {
        return {
            sceneStart: Number.isInteger(state?.sceneStart) ? state.sceneStart : null,
            sceneEnd: Number.isInteger(state?.sceneEnd) ? state.sceneEnd : null,
            highestProcessed: Number.isInteger(state?.highestMemoryProcessed) ? state.highestMemoryProcessed : null,
            changed: false,
            sceneChanged: false,
            toastrMessage: '',
        };
    }

    let newStart = Number.isInteger(state?.sceneStart) ? state.sceneStart : null;
    let newEnd = Number.isInteger(state?.sceneEnd) ? state.sceneEnd : null;
    let newHighestProcessed = Number.isInteger(state?.highestMemoryProcessed) ? state.highestMemoryProcessed : null;
    let changed = false;
    let sceneChanged = false;
    let toastrMessage = '';

    if (newStart === id && newEnd === id) {
        newStart = null;
        newEnd = null;
        changed = true;
        sceneChanged = true;
        toastrMessage = 'Scene cleared due to start marker deletion';
    } else if (newStart !== null && newEnd !== null) {
        if (id < newStart) {
            newStart--;
            newEnd--;
            changed = true;
            sceneChanged = true;
            toastrMessage = 'Scene markers adjusted due to message deletion.';
        } else if (id === newStart) {
            newStart = null;
            if (newEnd > id) {
                newEnd--;
            }
            changed = true;
            sceneChanged = true;
            toastrMessage = 'Scene start point cleared due to message deletion';
        } else if (id > newStart && id < newEnd) {
            newEnd--;
            changed = true;
            sceneChanged = true;
            toastrMessage = 'Scene markers adjusted due to message deletion.';
        } else if (id === newEnd) {
            newEnd = null;
            changed = true;
            sceneChanged = true;
            toastrMessage = 'Scene end point cleared due to message deletion';
        }
    } else if (newStart !== null) {
        if (id < newStart) {
            newStart--;
            changed = true;
            sceneChanged = true;
            toastrMessage = 'Scene markers adjusted due to message deletion.';
        } else if (id === newStart) {
            newStart = null;
            changed = true;
            sceneChanged = true;
            toastrMessage = 'Scene start point cleared due to message deletion';
        }
    } else if (newEnd !== null) {
        if (id < newEnd) {
            newEnd--;
            changed = true;
            sceneChanged = true;
            toastrMessage = 'Scene markers adjusted due to message deletion.';
        } else if (id === newEnd) {
            newEnd = null;
            changed = true;
            sceneChanged = true;
            toastrMessage = 'Scene end point cleared due to message deletion';
        }
    }

    if (newHighestProcessed !== null) {
        const rebasedHighestProcessed = id <= newHighestProcessed
            ? newHighestProcessed - 1
            : newHighestProcessed;
        const clampedHighestProcessed = chatLength > 0
            ? Math.min(rebasedHighestProcessed, chatLength - 1)
            : null;
        if (clampedHighestProcessed !== newHighestProcessed) {
            newHighestProcessed = clampedHighestProcessed;
            changed = true;
        }
    }

    if (chatLength <= 0) {
        if (newStart !== null || newEnd !== null) {
            changed = true;
        }
        newStart = null;
        newEnd = null;
    } else {
        if (newStart !== null && (newStart < 0 || newStart >= chatLength)) {
            newStart = null;
            changed = true;
        }
        if (newEnd !== null && (newEnd < 0 || newEnd >= chatLength)) {
            newEnd = chatLength - 1;
            changed = true;
        }
        if (newStart !== null && newEnd !== null && newStart > newEnd) {
            newStart = null;
            newEnd = null;
            changed = true;
        }
    }

    return {
        sceneStart: newStart,
        sceneEnd: newEnd,
        highestProcessed: newHighestProcessed,
        changed,
        sceneChanged,
        toastrMessage,
    };
}

function computeLorebookEntryOrder(lorebookSettings, orderNumber, options = {}) {
    const modeRaw = String(lorebookSettings?.orderMode || 'auto').toLowerCase();
    const mode = modeRaw === 'manual' || modeRaw === 'reverse' ? modeRaw : 'auto';
    const safeOrderNumber = Number.isFinite(Number(orderNumber)) ? Math.max(1, Math.trunc(Number(orderNumber))) : 1;
    const reverseStart = clampReverseStart(lorebookSettings?.reverseStart, 9999);
    const rawOrder = mode === 'manual'
        ? lorebookSettings?.orderValue
        : mode === 'reverse'
            ? reverseStart - (safeOrderNumber - 1)
            : safeOrderNumber;
    const rawOrderNum = Number(rawOrder);
    const sourceLabel = mode === 'manual'
        ? 'manual order value'
        : mode === 'reverse'
            ? `computed order (from ${options.orderNumberLabel || 'entry'} #${safeOrderNumber})`
            : (options.orderNumberLabel || 'entry number');

    let finalOrder = rawOrder;
    if (!Number.isFinite(rawOrderNum)) {
        finalOrder = mode === 'manual' ? 100 : safeOrderNumber;
    } else if (rawOrderNum < 0 || rawOrderNum > 9999) {
        const clampedNum = Math.min(9999, Math.max(0, Math.trunc(rawOrderNum)));
        finalOrder = clampedNum;
        if (typeof options.onOrderClamped === 'function') {
            options.onOrderClamped({
                source: sourceLabel,
                requested: rawOrderNum,
                clamped: clampedNum,
            });
        }
    }

    return Number.isFinite(Number(finalOrder))
        ? Math.min(9999, Math.max(0, Math.trunc(Number(finalOrder))))
        : (mode === 'manual' ? 100 : safeOrderNumber);
}

export function applyLorebookSettings(entry, profile, options = {}) {
    const target = entry;
    const config = normalizeLorebookEntrySettings(profile, DEFAULT_LOREBOOK_ENTRY_SETTINGS);
    const orderNumber = Number.isFinite(Number(options.orderNumber)) ? Math.max(1, Math.trunc(Number(options.orderNumber))) : 1;

    switch (config.constVectMode) {
        case 'blue':
            target.constant = true;
            target.vectorized = false;
            break;
        case 'green':
            target.constant = false;
            target.vectorized = false;
            break;
        case 'link':
        default:
            target.constant = false;
            target.vectorized = true;
            break;
    }

    target.position = config.position;
    if (config.position === 7 && config.outletName) target.outletName = config.outletName;
    else delete target.outletName;

    target.order = computeLorebookEntryOrder(config, orderNumber, {
        orderNumberLabel: options.orderNumberLabel || 'entry',
        onOrderClamped: options.onOrderClamped,
    });
    target.preventRecursion = config.preventRecursion;
    target.delayUntilRecursion = config.delayUntilRecursion;
    target.ignoreBudget = config.ignoreBudget;
    target.keysecondary = [];
    target.selective = true;
    target.selectiveLogic = 0;
    target.addMemo = true;
    target.disable = false;
    target.excludeRecursion = false;
    target.probability = 100;
    target.useProbability = true;
    target.depth = 4;
    target.group = '';
    target.groupOverride = false;
    target.groupWeight = 100;
    target.scanDepth = null;
    target.caseSensitive = null;
    target.matchWholeWords = null;
    target.useGroupScoring = null;
    target.automationId = '';
    target.role = null;
    target.sticky = 0;
    target.cooldown = 0;
    target.delay = 0;
    target.displayIndex = orderNumber;
    target[STMB_MANAGED_FLAG] = true;

    return target;
}

function sanitizeTitle(title) {
    return String(title ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim() || 'Auto Memory';
}

export function getEntryByTitle(lorebookData, title) {
    const target = String(title || '');
    if (!target) {
        return null;
    }

    const entries = Object.values(lorebookData?.entries || {});
    for (const entry of entries) {
        if (String(entry?.comment || '') === target) {
            return entry;
        }
    }

    return null;
}

export function findFirstLorebookEntryByTitle(lorebookData, titles = []) {
    for (const title of Array.isArray(titles) ? titles : []) {
        const found = getEntryByTitle(lorebookData, title);
        if (found) {
            return found;
        }
    }

    return null;
}

function escapeRegex(string) {
    return String(string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSequenceUsingTitleFormat(title, titleFormat) {
    const normalizedTitle = String(title || '');
    const normalizedFormat = String(titleFormat || '');
    if (!normalizedTitle || !normalizedFormat) {
        return null;
    }

    const numberingPatterns = [
        /\[\[(0+)\]\]/g,
        /\(\[(0+)\]\)/g,
        /\{\[(0+)\]\}/g,
        /#\[(0+)\]/g,
        /\[(0+)\]/g,
        /\((0+)\)/g,
        /\{(0+)\}/g,
        /#(0+)/g,
    ];

    let selectedPattern = null;
    for (const pattern of numberingPatterns) {
        if (pattern.test(normalizedFormat)) {
            selectedPattern = pattern;
            break;
        }
    }

    if (!selectedPattern) {
        return parseSequenceFromTitle(normalizedTitle);
    }

    let regexSource = escapeRegex(normalizedFormat)
        .replace(/\\\{\\\{[^}]+\\\}\\\}/g, '.*?');

    regexSource = regexSource
        .replace(/\\\[\\\[(0+)\\\]\\\]/g, '\\[(\\d+)\\]')
        .replace(/\\\(\\\[(0+)\\\]\\\)/g, '\\((\\d+)\\)')
        .replace(/\\\{\\\[(0+)\\\]\\\}/g, '\\{(\\d+)\\}')
        .replace(/#\\\[(0+)\\\]/g, '#(\\d+)')
        .replace(/\\\[(0+)\\\]/g, '(\\d+)')
        .replace(/\\\((0+)\\\)/g, '\\((\\d+)\\)')
        .replace(/\\\{(0+)\\\}/g, '\\{(\\d+)\\}')
        .replace(/#(0+)/g, '#(\\d+)');

    try {
        const match = normalizedTitle.match(new RegExp(`^${regexSource}$`));
        if (match?.[1]) {
            const value = Number(match[1]);
            if (Number.isFinite(value)) {
                return value;
            }
        }
    } catch {
    }

    return parseSequenceFromTitle(normalizedTitle);
}

function formatLocalDatePart(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatLocalTimePart(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function applyNumberingPattern(format, sequenceNumber) {
    const numberPatterns = [
        { regex: /\[\[(0+)\]\]/g, render: digits => `[${String(sequenceNumber).padStart(digits.length, '0')}]` },
        { regex: /\(\[(0+)\]\)/g, render: digits => `(${String(sequenceNumber).padStart(digits.length, '0')})` },
        { regex: /\{\[(0+)\]\}/g, render: digits => `{${String(sequenceNumber).padStart(digits.length, '0')}}` },
        { regex: /#\[(0+)\]/g, render: digits => `#${String(sequenceNumber).padStart(digits.length, '0')}` },
        { regex: /\[(0+)\]/g, render: digits => String(sequenceNumber).padStart(digits.length, '0') },
        { regex: /\((0+)\)/g, render: digits => `(${String(sequenceNumber).padStart(digits.length, '0')})` },
        { regex: /\{(0+)\}/g, render: digits => `{${String(sequenceNumber).padStart(digits.length, '0')}}` },
        { regex: /#(0+)/g, render: digits => `#${String(sequenceNumber).padStart(digits.length, '0')}` },
    ];

    for (const pattern of numberPatterns) {
        if (!pattern.regex.test(format)) continue;
        return format.replace(pattern.regex, (_, digits) => pattern.render(digits));
    }

    return format;
}

export function formatMemoryTitle(titleFormat, context, sequenceNumber) {
    const format = String(titleFormat || STMB_DEFAULT_TITLE_FORMAT);
    const sceneRange = context?.sceneRange || `${context?.sceneStart ?? '?'}-${context?.sceneEnd ?? '?'}`;
    const replacements = {
        title: sanitizeTitle(context?.title || 'Memory'),
        scene: `Scene ${sceneRange || 'Unknown'}`,
        char: String(context?.characterName || '').trim() || 'Unknown',
        user: String(context?.userName || '').trim() || 'User',
        messages: String(context?.messageCount ?? 0),
        profile: String(context?.profileName || '').trim() || 'Unknown',
        date: String(context?.date || ''),
        time: String(context?.time || ''),
    };

    let result = applyNumberingPattern(format, sequenceNumber);
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => replacements[key] ?? '');
    return sanitizeTitle(result);
}

export function validateTitleFormat(format) {
    const errors = [];
    const warnings = [];
    const value = String(format ?? '');

    if (!value.trim()) {
        errors.push('Title format must be a non-empty string');
        return { valid: false, errors, warnings };
    }

    const withoutPlaceholders = value.replace(/\{\{[^}]+\}\}/g, '');
    if (/[\u0000-\u001F\u007F-\u009F]/.test(withoutPlaceholders)) {
        warnings.push('Title contains characters that will be removed during sanitization');
    }

    const validPlaceholders = new Set(['{{title}}', '{{scene}}', '{{char}}', '{{user}}', '{{messages}}', '{{profile}}', '{{date}}', '{{time}}']);
    const invalidPlaceholders = [...value.matchAll(/\{\{[^}]*\}\}/g)]
        .map(match => match[0])
        .filter(token => !validPlaceholders.has(token));
    if (invalidPlaceholders.length > 0) {
        warnings.push(`Unknown placeholders: ${invalidPlaceholders.join(', ')}`);
    }

    const potentialNumberingPatterns = [...withoutPlaceholders.matchAll(/\[\[[^\]]+\]\]|\(\[[^\]]+\]\)|\{\[[^\]]+\]\}|#\[[^\]]+\]|\[[^\]]+\]|\([^)]*\)|\{[^}]*\}|#[^\s#{}()[\]]+/g)]
        .map(match => match[0])
        .filter(token => /0/.test(token));
    const allowedNumberingPatterns = [
        /^\[\[0+\]\]$/,
        /^\(\[0+\]\)$/,
        /^\{\[0+\]\}$/,
        /^#\[0+\]$/,
        /^\[0+\]$/,
        /^\(0+\)$/,
        /^\{0+\}$/,
        /^#0+$/,
    ];
    const invalidNumberingPatterns = potentialNumberingPatterns.filter(token => !allowedNumberingPatterns.some(pattern => pattern.test(token)));
    if (invalidNumberingPatterns.length > 0) {
        warnings.push(`Invalid numbering patterns: ${invalidNumberingPatterns.join(', ')}. Use [000] for plain digits, [[000]] for [000], plus (000), {000}, #000, #[000], ([000]), or {[000]}.`);
    }

    if (value.length > 100) {
        warnings.push('Title format is very long and may be truncated');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

export function previewTitle(titleFormat, sampleData = {}) {
    const mockEntries = {
        existing1: { uid: 5, comment: '001 - Previous Memory', [STMB_MANAGED_FLAG]: true },
        existing2: { uid: 7, comment: '002 - Another Memory', [STMB_MANAGED_FLAG]: true },
    };
    const nextSequenceNumber = getNextManagedMemorySequenceNumber(mockEntries, titleFormat);
    const defaultContext = {
        title: 'Sample Memory Title',
        sceneStart: 15,
        sceneEnd: 23,
        characterName: 'Alice',
        userName: 'Bob',
        messageCount: 9,
        profileName: 'Summary',
        date: '2026-01-02',
        time: '03:04:05',
    };

    try {
        return formatMemoryTitle(titleFormat, { ...defaultContext, ...(sampleData || {}) }, nextSequenceNumber);
    } catch (error) {
        return `Error: ${String(error?.message || error)}`;
    }
}

export function getNextManagedMemorySequenceNumber(entries, titleFormat = null) {
    const existingNumbers = Object.values(entries || {})
        .filter(entry => entry && entry[STMB_MANAGED_FLAG] === true)
        .map(entry => {
            const title = entry?.comment || entry?.title || '';
            return titleFormat
                ? extractSequenceUsingTitleFormat(title, titleFormat)
                : parseSequenceFromTitle(title);
        })
        .filter(value => Number.isFinite(value));

    if (existingNumbers.length === 0) {
        return 1;
    }

    return Math.max(...existingNumbers) + 1;
}

export function createManagedLorebookEntryData(memoryObject, context, profile, sequenceNumber, options = {}) {
    const now = new Date();
    const generatedTitle = formatMemoryTitle(profile?.titleFormat || context?.titleFormat, {
        ...context,
        title: memoryObject.title,
        sceneRange: context?.sceneRange || `${context?.sceneStart ?? '?'}-${context?.sceneEnd ?? '?'}`,
        date: formatLocalDatePart(now),
        time: formatLocalTimePart(now),
        profileName: profile?.name || '',
    }, sequenceNumber);
    const title = typeof options?.entryTitle === 'string' && options.entryTitle.trim()
        ? options.entryTitle.trim()
        : generatedTitle;

    const normalizedContent = String(memoryObject.content || '').trim();
    const entry = {
        comment: title,
        content: normalizedContent ? `${normalizedContent}\n\n` : '',
        key: normalizeKeywords(memoryObject.keywords),
        [STMB_MANAGED_FLAG]: true,
    };

    if (Number.isInteger(context?.sceneStart) && Number.isInteger(context?.sceneEnd)) {
        entry.STMB_start = context.sceneStart;
        entry.STMB_end = context.sceneEnd;
        if (typeof context?.sceneStartUuid === 'string' && typeof context?.sceneEndUuid === 'string') {
            entry.STMB_startUuid = context.sceneStartUuid;
            entry.STMB_endUuid = context.sceneEndUuid;
        }
    }

    const characterFilterNames = normalizeStmbCharacterFilterNames(
        options?.characterFilterNames ?? context?.characterFilterNames,
    );
    if (characterFilterNames.length > 0) {
        entry.characterFilter = {
            isExclude: false,
            names: characterFilterNames,
            tags: [],
        };
    }

    if (options?.inclusionGroup) {
        entry.group = String(options.inclusionGroup);
        entry.STMB_inclusionGroup = String(options.inclusionGroup);
    }
    if (options?.entryMetadata && typeof options.entryMetadata === 'object' && !Array.isArray(options.entryMetadata)) {
        for (const [key, value] of Object.entries(options.entryMetadata)) {
            if (key === 'uid' || key === 'comment' || key === 'content') continue;
            entry[key] = structuredClone(value);
        }
    }

    return entry;
}
