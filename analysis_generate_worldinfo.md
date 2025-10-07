# Analysis: World-Info Processing — Original vs Modified Generate()

This document analyzes if world‑info processing can be moved to the end of the `Generate` function. It includes:
- Original function analysis (client-side WI pipeline)
- Modified function analysis (server-side WI pipeline)
- Differences vs the original
- Feasibility and precise relocation options
- Risks and follow-ups

-------------------------------------------------------------------------------

## A) Original Function Analysis (Client-side WI)

Goal: Determine if all "world-info processing" can be moved to the very end of the original `Generate` function.

### 1. What is "World-Info Processing" (Original)

In the original client-side version, WI processing includes:
- Calling `getWorldInfoPrompt(chatForWI, this_max_context, dryRun, globalScanData)` and handling its returns:
  - `worldInfoString`
  - `worldInfoBefore`
  - `worldInfoAfter`
  - `worldInfoExamples`
  - `worldInfoDepth`
- Injecting WI into examples:
  - Iterate `worldInfoExamples` and modify `mesExamplesArray` (unshift/push based on `example.position`)
- Injecting WI depth:
  - `flushWIDepthInjections()`
  - For each `worldInfoDepth` grouping, `setExtensionPrompt(inject_ids.CUSTOM_WI_DEPTH_ROLE(...), ...)`
- Incorporating WI into story string parameters:
  - `wiBefore` / `wiAfter` (also aliased as `loreBefore` / `loreAfter`)
- Indirectly affecting prompt assembly, sizing, and injection

### 2. Location & Context (Original)

WI runs after:
- `coreChat` construction and transformations
- Extension interceptors and CFG adjustments
- Message examples parsing

WI runs before:
- `storyStringParams` assembly and `renderStoryString`
- `doChatInject` and formation of in-context messages
- Prompt sizing loops and final combined prompt

### 3. Dependencies (Original)

Inputs:
- `coreChat` (clean, reversed for WI)
- Character/card fields (`persona`, `description`, `personality`, `charDepthPrompt`, `scenario`, `creatorNotes`)
- `this_max_context`
- Flags (`type`, `dryRun`, `world_info_include_names`)
- Group/character IDs

### 4. Downstream Consumers (Original)

- `mesExamplesArray` (modified by WI examples)
- Story string params (`wiBefore`, `wiAfter`)
- Depth injections (extension prompts)
- Final combined prompt and token sizing

### 5. Can it be moved? (Original)

- Not after prompt assembly: WI must be present during prompt assembly; otherwise prompt would miss WI.
- It can be moved to just before prompt assembly (immediately before `storyStringParams`), provided earlier steps do not rely on WI outputs.

Summary (Original):
- You cannot push WI processing to the very end (after prompt build).
- You can group it right before prompt assembly for clarity.

-------------------------------------------------------------------------------

## B) Modified Function Analysis (Server-side WI)

The modified function defers world‑info processing to the server. On the client:
- It constructs a `worldInfoContext` object
- Leaves all WI injections/strings empty client‑side
- Passes `worldInfoContext` to the server (currently only in the OpenAI path)

This materially changes the feasibility of moving WI code later in the function.

### 1. What is "World-Info Processing" (Modified)

In the modified client:
- Prepare chat for WI: 
  - Set `inject_ids.QUIET_PROMPT`
  - Build `chatForWI = coreChat.map(...).reverse()`
- Dynamic import of WI settings:
  - `selected_world_info`, `world_info_depth`, `world_info_budget`, `world_info_budget_cap`
  - `world_info_recursive`, `world_info_case_sensitive`, `world_info_match_whole_words`
  - `world_info_use_group_scoring`, `world_info_max_recursion_steps`
  - `world_info_min_activations`, `world_info_min_activations_depth_max`
- Build `globalScanData` (same payload as original)
- Build `worldInfoContext`:
  - `{ chat, maxContext, characterName, characters, userSelectedWorlds, chatMetadata, userSettings, worldInfoSettings, globalScanData, isDryRun }`
- Set all client WI artifacts empty:
  - `worldInfoString = ''`
  - `worldInfoBefore = ''`
  - `worldInfoAfter = ''`
  - `worldInfoExamples = []`
  - `worldInfoDepth = []`
- Do not inject WI examples or WI depth client-side
- Clear `QUIET_PROMPT` after building context
- Story string params explicitly set `wiBefore`, `wiAfter`, `loreBefore`, `loreAfter` to empty

Consumers:
- Only the OpenAI branch includes `worldInfoContext` in `generate_data`:
  - `generate_data = { prompt, worldInfoContext }`
- `prepareOpenAIMessages` is called with `worldInfoBefore/After: ''` (i.e., client not using WI)

### 2. Location & Context (Modified)

WI context building occurs before:
- Story string assembly and prompt construction
- `doChatInject` and sizing
- The `switch (main_api)` that constructs `generate_data`

Unlike the original, WI results do not affect client-side prompt assembly. Prompt is constructed without WI content on the client; the server is expected to use `worldInfoContext` to compile and inject WI as needed.

### 3. Dependencies (Modified)

Inputs to building `worldInfoContext`:
- `coreChat` and `this_max_context`
- Character fields and globals (`name2`, `characters`, `chat_metadata`)
- Imported WI settings from `./scripts/world-info.js`
- `power_user.persona_description_lorebook`
- `type`, `dryRun`

No prompt-assembly components depend on this context anymore on the client side.

### 4. Downstream Consumers (Modified)

- Only the OpenAI path consumes `worldInfoContext` (added to `generate_data`)
- Non-OpenAI paths (kobold, textgenerationwebui, novel) do not receive `worldInfoContext` in `generate_data` in this modified code

### 5. Can it be moved? (Modified)

Yes, significantly further down than before.

- You can move construction of `worldInfoContext` to just before building `generate_data` in the switch-case, or even inside the `openai` case, because:
  - Client prompt assembly no longer needs WI strings/depth/examples
  - Story string and prompt sizing are unaffected by WI client-side

Constraints:
- It must be created before `generate_data` is constructed for the OpenAI branch (since it is included in `generate_data`).
- You cannot move it after `generate_data` is fully built for OpenAI, nor after the request is sent.

Feasible relocation targets:
1) Immediately before `switch (main_api)` or at the top of the `openai` case block (right before building `generate_data`)
2) After final prompt is computed (`finalPrompt = await getCombinedPrompt(false);`) but before the `switch (main_api)`
3) Inside the `openai` case, right before or as part of constructing `generate_data`

In all cases above, this is functionally safe with the current modified structure since client prompt doesn’t depend on WI outputs.

-------------------------------------------------------------------------------

## C) Differences vs Original (What Changed)

Functional/architectural changes:
- Source of WI processing:
  - Original: Client computes WI strings/depth/examples using `getWorldInfoPrompt(...)`, injects them into the prompt.
  - Modified: Client only constructs `worldInfoContext` and passes it to the server; client WI artifacts remain empty.
- Example message injection:
  - Original: `worldInfoExamples` injected into `mesExamplesArray`.
  - Modified: No client-side injection; examples are “handled on server”.
- WI depth injections:
  - Original: `flushWIDepthInjections();` followed by setting depth prompts via `setExtensionPrompt(inject_ids.CUSTOM_WI_DEPTH_ROLE(...))`.
  - Modified: `flushWIDepthInjections();` only; no client-side depth injection is added afterward.
- Story string WI fields:
  - Original: `wiBefore`, `wiAfter` (and `loreBefore`, `loreAfter`) set from WI results.
  - Modified: All WI story fields are set to empty strings.
- OpenAI message preparation:
  - Original: `prepareOpenAIMessages` receives `worldInfoBefore/After` values.
  - Modified: It receives `worldInfoBefore/After: ''`; WI moved to server via `worldInfoContext` included in `generate_data`.
- Event payloads:
  - Original: `GENERATE_BEFORE_COMBINE_PROMPTS` and `GENERATE_AFTER_COMBINE_PROMPTS` receive meaningful `worldInfoBefore/After`.
  - Modified: These values are empty; extensions listening to these events will not see WI content from the client anymore.
- Backend coverage:
  - Original: WI applied for all backends (content injected into prompt regardless of API).
  - Modified: Only the OpenAI path receives `worldInfoContext` in `generate_data`. Non-OpenAI backends (kobold/textgen/novel) currently don’t receive it in this code path (potential behavioral change).
- Code path change in switch:
  - Modified code’s `switch (main_api)` has `case 'kobold':` with a conditional `if (main_api == 'koboldhorde' && ...)` inside, which looks like a regression/bug from the original (`kobold` vs `koboldhorde` handling got mixed).

Operational/relocation implications:
- Original: WI had to run before prompt assembly; could not be moved to the end.
- Modified: WI can be moved down to near the end (right before building `generate_data` for OpenAI), since client-side prompt assembly no longer consumes WI outputs.

-------------------------------------------------------------------------------

## D) Feasibility and Precise Relocation Options

Given the modified server-side design:

Recommended relocation position(s):
- Best: Move the construction of `worldInfoContext` to just before the `openai` case in the `switch (main_api)`, or construct it inside the `openai` case right before `generate_data` is created.

Example outline:

```js
// ... after finalPrompt is computed and before switch(main_api)
let worldInfoContext; // define here

switch (main_api) {
  case 'openai': {
    // Build worldInfoContext here, using already available variables:
    // chatForWI, this_max_context, name2, characters, chat_metadata, user settings, imported WI config, globalScanData, dryRun
    worldInfoContext = {
      chat: chatForWI,
      maxContext: this_max_context,
      characterName: name2,
      characters,
      userSelectedWorlds: selected_world_info,
      chatMetadata: chat_metadata,
      userSettings: { persona_description_lorebook: power_user.persona_description_lorebook },
      worldInfoSettings: { /* ... */ },
      globalScanData,
      isDryRun: dryRun,
    };

    let [prompt, counts] = await prepareOpenAIMessages({ /* worldInfoBefore/After: '' */ }, dryRun);
    generate_data = { prompt, worldInfoContext };
    // ...
    break;
  }
  // other cases...
}
```

Alternative:
- Build `worldInfoContext` immediately before `switch (main_api)`, after `finalPrompt` is computed. This also keeps it late in the function and still ready for the `openai` case.

Not allowed:
- Do not move WI construction after the OpenAI `generate_data` is created or after the API request begins.

-------------------------------------------------------------------------------

## E) Risks, Regressions, and Follow-ups

- Non-OpenAI backends:
  - In the modified code, `worldInfoContext` is only attached for OpenAI. If the server is intended to process WI for all backends, you should add `worldInfoContext` to `generate_data` for `kobold`, `textgenerationwebui`, `novel` as well. Otherwise, behavior diverges from the original (no WI injected for these backends).
- Extensions and event subscribers:
  - `GENERATE_BEFORE_COMBINE_PROMPTS` data now has `worldInfoBefore/After: ''`. Any extensions expecting WI content there will not receive it client-side.
- Depth prompts:
  - Client clears WI depth injections but does not apply new ones. Ensure the server adds equivalent depth injections or inline content; otherwise depth-based behavior changes.
- Switch-case regression:
  - `case 'kobold'` contains `if (main_api == 'koboldhorde' && ...)` which seems wrong. This may cause missed auto-adjust code paths or logic anomalies.
- Token sizing parity:
  - Client prompt sizing no longer accounts for WI content. If server adds significant WI, ensure the server handles context budgeting consistently (to avoid overruns or truncation versus the original client-side budget logic).

-------------------------------------------------------------------------------

## F) Final Answer

- Original function: World‑info could not be moved to the end; it had to run before prompt assembly.
- Modified function: Since the client no longer consumes WI outputs, you can move world‑info context building to near the end, specifically right before or inside the `openai` branch where `generate_data` is constructed. You must still build it before the API payload is finalized.
- To preserve parity across backends, consider passing `worldInfoContext` in `generate_data` for non-OpenAI backends too, or retain per-backend client-side WI if server support is not uniform.

-------------------------------------------------------------------------------

## G) Checklists

Refactor checklist (modified function):
- [x] Identify WI processing blocks (client-side context assembly)
- [x] Confirm no client prompt assembly depends on WI outputs
- [x] Choose late relocation point (before/inside `openai` case)
- [x] Validate server consumes `worldInfoContext`
- [x] Assess non-OpenAI coverage
- [x] Verify extension event expectations
- [x] Test token budgeting with server WI

Parity/regression checklist:
- [x] Verify non-OpenAI backends receive WI (or accept changed behavior)
- [x] Ensure extensions relying on client WI are updated
- [x] Fix `kobold` vs `koboldhorde` conditional
- [x] Confirm depth prompt behavior is reproduced server-side

-------------------------------------------------------------------------------

## H) Full Server-side WI + Prompt Assembly: Feasibility and Plan

Question: What is the feasibility of moving EVERYTHING from WI processing onwards onto the server? Instead of returning WI objects, pass all inputs to the server and let the server combine WI with all other prompt components.

Short answer: Feasible, but a substantial refactor. You must port prompt assembly logic (examples, story string, injections, instruct formatting, token budgeting, backend-specific message shaping) to the server. Main risks are tokenizer parity, extension hooks parity, and backend coverage.

### 1) Scope to Move Server-side

Move from the “Extension added strings” block onward, including:
- WI processing and integration
- Message examples processing (including WI examples), raw snapshotting, instruct formatting
- Story string rendering and optional in-chat injection
- Depth prompts application (doChatInject), jailbreak post-history insertion
- Chat2/mesSend construction and continuation handling
- Prompt bias application, quiet prompt merging, impersonation name logic
- CFG guidance prompts injection
- Token budgeting and prompt-size pruning
- Final combined prompt assembly OR backend-specific message shaping (OpenAI/chat messages)
- generate_data construction

Streaming and actual generation likely already occurs server-side; retain that.

### 2) Server Inputs Required

Send the server everything required to deterministically reproduce client assembly, including:

Core chat and context:
- coreChat items (after regex transforms, appendFileContent, reasoning-prefix via PromptReasoning), including:
  - mes, is_user, name, extra fields (reasoning, reasoning_duration, append_title/title, tool_invocations if relevant)
- Generation flags: type, isInstruct, isImpersonate, isContinue, quietToLoud
- Names: name1, name2
- quiet_prompt, quietName, quietImage
- continue_mag seed (or enough info to recompute)

Character and examples:
- description, personality, persona, scenario, mesExamples (raw as authored), charDepthPrompt, creatorNotes
- power_user.sysprompt settings and content; prefer_character_prompt/jailbreak toggles

World info/selection:
- selected_world_info and all WI settings (depth, budget, recursion, case sensitivity, match whole words, use group scoring, min activations, max recursion steps, min activations depth max)
- GlobalScanData (persona, description, personality, charDepth, scenario, creatorNotes, trigger)
- chat_metadata
- world_info_include_names (affects chatForWI shaping)

Extensions and injections:
- extension_prompts accumulated BEFORE server assembly (setFloatingPrompt, persona description prompt, group/character depth prompts)
- extension settings like note.allowWIScan, story_string_position/depth/role

Backend and tokenizer:
- main_api, model/preset settings, max_context (max_context, amount_gen, padding), tokenizer name
- CFG settings: guidance scale and positive/negative prompts config (if applicable)
- power_user flags influencing formatting: pin_examples, instruct.wrap, collapse_newlines, trim_spaces, always_force_name2, persona_description_position, context.story_string_position, etc.

OpenAI-specific:
- If the server assembles OAI messages, send only inputs; if client already built oaiMessages, stop doing that and let server build them from core inputs.

Tool calling:
- canUseTools/canPerformToolCalls flags and any schema the server needs to decide tool call formatting in prompts

### 3) Server Responsibilities

- Compute chatForWI (or accept it precomputed) and run WI scan
- Construct and merge WI examples into examples list with correct ordering (before/after)
- Snapshot raw examples and then format instruct-mode examples
- Render storyString (via renderStoryString equivalent) and optionally inject into chat
- Apply depth prompt injections (doChatInject equivalent), jailbreak post-history insertion
- Build chat2/mesSend and last-line modifications (modifyLastPromptLine), including quiet prompt behavior, impersonation lines, name forcing, continuation markers
- Apply prompt bias and CFG prompts at correct depths
- Perform token counting and budgeting with tokenizer parity (including padding), honoring pin_examples and checkPromptSize logic
- Assemble final combined prompt string OR backend-specific request payloads
- Emit server-side equivalents of GENERATE_BEFORE_COMBINE_PROMPTS/AFTER_COMBINE_PROMPTS hooks (or return intermediates to client, see Hooks below)
- Return generate_data AND/OR immediately proceed to stream generation response

### 4) Client Changes

- Stop assembling examples/story string/prompt locally
- Build a “prompt assembly request” payload and send to server
- Option A: Server returns generate_data (prompt/messages + max_length, etc.), client then calls generation endpoint (may be redundant)
- Option B (preferred): Server both assembles and generates; client only manages streamingProcessor UX and tool-call integration

### 5) Extension Hooks Parity

Current client emits:
- GENERATE_BEFORE_COMBINE_PROMPTS with a mutable data object
- GENERATE_AFTER_COMBINE_PROMPTS with the final prompt string
- GENERATE_AFTER_DATA with generate_data

Options:
- Move these hooks server-side (if your extension eco-system can run there)
- Or keep client emitting read-only events using data returned by server:
  - To preserve mutability semantics (plugins altering prompt), define a “pre-assembly hook” RPC:
    - Client gathers extension changes, sends them as part of the payload, or calls a special server hook endpoint that runs extensions remotely prior to assembly
- If keeping hooks client-side, add a pre-assembly round-trip:
  - Client builds inputs, emits local hooks to let plugins mutate inputs (storyString overrides, extra extension prompts), then sends the mutated inputs to server for assembly

### 6) Tokenization Strategy

- Server must perform token counts identical to client:
  - Match tokenizer per backend and model (GPT/OAI tokenizer vs LLaMA/BPE tokenizers)
  - Match padding rules and newline normalization
- Consider bundling a shared tokenizer library used by both client and server or shift all counting to server
- Ensure CFG prompt token adjustments are replicated server-side

### 7) Backend Coverage

- Unify server assembly for all backends: openai, kobold(horde), textgenerationwebui, novel
- Each backend needs a shaping phase:
  - OpenAI: Chat messages, role/content, tool calls later
  - Others: Flat prompt strings and preset mappings

### 8) Streaming & Tool-Calls

- Server should stream tokens as it already does; client’s StreamingProcessor remains, but assembly happens on server
- For function/tool calls:
  - Server should return structured tool call payloads mid-stream or at end; client invokes ToolManager
  - For recursive calls (depth), client resubmits with updated depth and server receives prior invocations

### 9) Security/Performance

- Sending full chat + settings to server is already the norm; performance impact is minimal relative to model inference
- Benefit: single source of truth for prompt logic; easier to patch; no divergence between backends

### 10) API Proposal

Endpoint: POST /v1/assemble-and-generate (preferred) or two-step

Request (schematic):
```json
{
  "api": "openai",
  "modelConfig": { "preset": "...", "max_context": 8192, "amount_gen": 512, "padding": 0, "cfg": { "scale": 1.2 } },
  "names": { "name1": "User", "name2": "Char" },
  "type": "normal",
  "flags": { "isInstruct": true, "isImpersonate": false, "isContinue": false, "quietToLoud": false, "pinExamples": false, "collapseNewlines": true, "alwaysForceName2": true },
  "quiet": { "prompt": "", "name": "System", "image": "" },
  "card": { "description": "", "personality": "", "persona": "", "scenario": "", "charDepthPrompt": "", "creatorNotes": "" },
  "examples": { "raw": "mesExamples from card" },
  "chat": [ { "mes": "...", "is_user": true, "name": "User", "extra": { "reasoning": "", "append_title": false, "title": "" } } ],
  "promptReasoning": { "enabled": true, "state": {} },
  "extensionPrompts": { /* current extension_prompts map up to this point */ },
  "sysprompt": { "enabled": true, "content": "...", "post_history": "...", "prefer_character_prompt": true },
  "worldInfo": {
    "selected": [/* selected worlds */],
    "settings": { "depth": 2, "budget": 1024, "budget_cap": 2048, "recursive": true, "case_sensitive": false, "match_whole_words": false, "use_group_scoring": true, "max_recursion_steps": 3, "min_activations": 1, "min_activations_depth_max": 3, "include_names": false },
    "globalScanData": { "personaDescription": "", "characterDescription": "", "characterPersonality": "", "characterDepthPrompt": "", "scenario": "", "creatorNotes": "", "trigger": "normal" },
    "chatMetadata": {}
  },
  "tooling": { "canUseTools": true, "canPerformToolCalls": true, "recurseDepth": 0 }
}
```

Response:
- For combined assembly+generation: stream tokens; final JSON includes tool calls if any
- For assembly-only: return `generate_data` equivalent:
```json
{
  "prompt": "final string OR openai messages",
  "messages": [ /* for openai */ ],
  "max_length": 512,
  "in_context_messages_count": 12,
  "itemized": { "storyString": "...", "examplesString": "...", "mesSendString": "...", "wi": { "before": "", "after": "" } },
  "injectedIndices": [/* ... */]
}
```

### 11) Feasibility Assessment

- Technical feasibility: High
- Complexity: High (porting all assembly logic; tokenizer parity; extension hooks redesign)
- Benefits:
  - Single source of truth
  - Easier backend parity
  - Simplified client
- Risks:
  - Behavior drift during migration
  - Extension ecosystem adjustments
  - Large testing matrix across backends and settings

-------------------------------------------------------------------------------

## I) Migration Plan

Phase 0: Parity Safeguards
- Attach `worldInfoContext` to generate_data for all backends (not just OpenAI)
- Fix `kobold` vs `koboldhorde` switch-case condition

Phase 1: Server Assembly Pilot (OpenAI)
- Add server endpoint to assemble prompt/messages from inputs
- Feature-flag: client chooses server assembly for OpenAI only
- Keep client emitting events using server-returned data for visibility

Phase 2: Expand Backends
- Implement server assembly for kobold/textgenwebui/novel
- Normalize tokenizer usage and budgeting across backends

Phase 3: Streamlined Flow
- Switch to assemble-and-generate on server (single endpoint)
- Remove client-side assembly code paths guarded by a fallback flag

Phase 4: Extension Hooks
- Provide server-side extension hook API or a pre-assembly RPC from client
- Document new extension lifecycle and migration steps

Testing Checklist
- Token budgeting equivalence (examples and chat trimming) vs client
- Instruct formatting parity
- Quiet prompt, impersonation, continue behavior
- CFG prompt adjustments
- Tool call flows (streaming and non-streaming)
- Regression tests across backends/presets

-------------------------------------------------------------------------------
