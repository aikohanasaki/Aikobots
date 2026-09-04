const TOOL_TURN_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking', 'tool_use']);

/** Clones the ordered Claude blocks required to continue a tool-use turn. */
export function extractClaudeToolTurnBlocks(content) {
    if (!Array.isArray(content)) return [];
    return content.filter(block => TOOL_TURN_BLOCK_TYPES.has(block?.type)).map(block => structuredClone(block));
}

/** Accumulates Claude streaming blocks, including opaque thinking signatures. */
export function accumulateClaudeToolTurnBlock(state, event) {
    state.claudeToolTurnBlocks ??= [];
    state.claudeToolInputDeltas ??= {};
    const index = Number.isInteger(event?.index) ? event.index : null;
    if (index === null) return;

    if (event.type === 'content_block_start' && TOOL_TURN_BLOCK_TYPES.has(event.content_block?.type)) {
        state.claudeToolTurnBlocks[index] = structuredClone(event.content_block);
    }
    const block = state.claudeToolTurnBlocks[index];
    if (!block) return;
    if (event.delta?.type === 'thinking_delta' && block.type === 'thinking') {
        block.thinking = String(block.thinking || '') + String(event.delta.thinking || '');
    } else if (event.delta?.type === 'signature_delta' && block.type === 'thinking') {
        block.signature = String(block.signature || '') + String(event.delta.signature || '');
    } else if (event.delta?.type === 'input_json_delta' && block.type === 'tool_use') {
        state.claudeToolInputDeltas[index] = String(state.claudeToolInputDeltas[index] || '') + String(event.delta.partial_json || '');
    } else if (event.type === 'content_block_stop' && block.type === 'tool_use' && state.claudeToolInputDeltas[index]) {
        try {
            block.input = JSON.parse(state.claudeToolInputDeltas[index]);
        } catch {
            // ToolManager reports malformed arguments; retain the original block for diagnostics.
        }
        delete state.claudeToolInputDeltas[index];
    }
}

/** Returns completed stored blocks without sparse stream indexes. */
export function getCompletedClaudeToolTurnBlocks(state) {
    return extractClaudeToolTurnBlocks(state?.claudeToolTurnBlocks?.filter(Boolean));
}
