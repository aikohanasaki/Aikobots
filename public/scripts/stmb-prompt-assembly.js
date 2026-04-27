import {
    compiledSceneToText,
    identifyManagedMemoryEntries,
} from './stmb-core.js';
import { applySidePromptMacros } from './stmb-sideprompt-macros.js';
import { getRequiredSummaryPromptText } from './stmb-summary-prompt-manager.js';

export function fetchPreviousMemories(worldInfo, count) {
    if (!Number.isFinite(Number(count)) || Number(count) <= 0) {
        return [];
    }

    return identifyManagedMemoryEntries(worldInfo?.entries || {})
        .slice(-Math.max(0, Math.min(7, Math.trunc(Number(count)))))
        .map(entry => ({
            title: entry.comment || 'Memory',
            content: entry.content || '',
            keywords: Array.isArray(entry.key) ? entry.key : [],
        }));
}

export function buildMemoryPromptMessages(compiledScene, profile, worldInfo, stmbSettings = {}) {
    return [{ role: 'user', content: buildMemoryPromptText(compiledScene, profile, worldInfo, stmbSettings) }];
}

export function buildMemoryPromptText(compiledScene, profile, worldInfo, stmbSettings = {}) {
    const basePrompt = typeof profile?.promptText === 'string' && profile.promptText.trim()
        ? profile.promptText
        : getRequiredSummaryPromptText(profile?.preset, stmbSettings);
    const presetPrompt = String(basePrompt || '')
        .replace(/\{\{user\}\}/g, String(compiledScene?.metadata?.userName || 'User'))
        .replace(/\{\{char\}\}/g, String(compiledScene?.metadata?.characterName || 'Character'));
    const memoryCount = Number(stmbSettings?.moduleSettings?.defaultMemoryCount) || 0;
    const previousMemories = fetchPreviousMemories(worldInfo, memoryCount);
    const messageLines = Array.isArray(compiledScene?.messages)
        ? compiledScene.messages
            .map(message => {
                const speaker = String(message?.name || 'Unknown').trim() || 'Unknown';
                const content = String(message?.mes || '').trim();
                return content ? `${speaker}: ${content}` : null;
            })
            .filter(Boolean)
        : [];
    const sceneLines = [];

    if (previousMemories.length > 0) {
        sceneLines.push('=== PREVIOUS SCENE CONTEXT (DO NOT SUMMARIZE) ===');
        sceneLines.push('These are previous memories for context only. Do NOT include them in your new memory:');
        sceneLines.push('');
        previousMemories.forEach((memory, index) => {
            sceneLines.push(`Context ${index + 1} - ${memory.title || 'Memory'}:`);
            sceneLines.push(String(memory.content || ''));
            if (Array.isArray(memory.keywords) && memory.keywords.length > 0) {
                sceneLines.push(`Keywords: ${memory.keywords.join(', ')}`);
            }
            sceneLines.push('');
        });
        sceneLines.push('=== END PREVIOUS SCENE CONTEXT - SUMMARIZE ONLY THE SCENE BELOW ===');
        sceneLines.push('');
    }

    sceneLines.push('=== SCENE TRANSCRIPT ===');
    sceneLines.push(...messageLines);
    sceneLines.push('');
    sceneLines.push('=== END SCENE ===');

    return `${presetPrompt}\n\n${sceneLines.join('\n')}`;
}

export function buildSidePromptText(templatePrompt, priorContent, compiledScene, responseFormat, previousMemories = [], runtimeMacros = {}) {
    const parts = [];
    parts.push(applySidePromptMacros(templatePrompt, runtimeMacros));
    if (priorContent && String(priorContent).trim()) {
        parts.push('\n=== PRIOR ENTRY ===\n');
        parts.push(String(priorContent));
    }
    if (previousMemories.length > 0) {
        parts.push('\n=== PREVIOUS SCENE CONTEXT (DO NOT SUMMARIZE) ===\n');
        parts.push('These are previous memories for context only. Do NOT include them in your new output.\n\n');
        previousMemories.forEach((memory, index) => {
            parts.push(`Context ${index + 1} - ${memory.title || 'Memory'}:\n`);
            parts.push(`${memory.content || ''}\n`);
            if (Array.isArray(memory.keywords) && memory.keywords.length > 0) {
                parts.push(`Keywords: ${memory.keywords.join(', ')}\n`);
            }
            parts.push('\n');
        });
        parts.push('=== END PREVIOUS SCENE CONTEXT ===\n');
    }
    parts.push('\n=== SCENE TEXT ===\n');
    parts.push(compiledSceneToText(compiledScene));
    if (responseFormat && String(responseFormat).trim()) {
        parts.push('\n=== RESPONSE FORMAT ===\n');
        parts.push(applySidePromptMacros(responseFormat, runtimeMacros).trim());
    }
    return parts.join('');
}
