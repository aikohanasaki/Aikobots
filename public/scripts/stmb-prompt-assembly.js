import {
    compiledSceneToText,
    identifyManagedMemoryEntries,
} from './stmb-core.js';
import { extension_settings } from './extensions.js';
import { getRegexScripts, runRegexScript } from './extensions/regex/engine.js';
import { applySidePromptMacros } from './stmb-sideprompt-macros.js';
import { getRequiredSummaryPromptText } from './stmb-summary-prompt-manager.js';

function cloneRegexScriptEnabled(script) {
    try {
        const clone = { ...script };
        clone.disabled = false;
        return clone;
    } catch {
        return script;
    }
}

export function applyStmbSelectedRegex(text, selectedKeys, logLabel = 'STMB selected regex') {
    if (typeof text !== 'string') return text;
    if (!Array.isArray(selectedKeys) || selectedKeys.length === 0) return text;

    try {
        const allScripts = getRegexScripts({ allowedOnly: false }) || [];
        const indices = selectedKeys
            .map(key => Number(String(key).replace(/^idx:/, '')))
            .filter(index => Number.isInteger(index) && index >= 0 && index < allScripts.length);

        let output = text;
        for (const index of indices) {
            output = runRegexScript(cloneRegexScriptEnabled(allScripts[index]), output);
        }
        return output;
    } catch (error) {
        console.warn(`${logLabel} application failed`, error);
        return text;
    }
}

function applyConfiguredStmbRegex(text, selectedKeysName, logLabel) {
    const moduleSettings = extension_settings?.STMemoryBooks?.moduleSettings;
    if (!moduleSettings?.useRegex) return text;
    return applyStmbSelectedRegex(text, moduleSettings?.[selectedKeysName], logLabel);
}

export function applyStmbIncomingRegex(text) {
    return applyConfiguredStmbRegex(text, 'selectedRegexIncoming', 'STMB sideprompt incoming regex');
}

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

function normalizeAdditionalContextEntries(entries = []) {
    return (Array.isArray(entries) ? entries : [])
        .map(entry => ({
            title: String(entry?.title || entry?.comment || 'Context').trim() || 'Context',
            content: String(entry?.content || '').trim(),
            lorebookName: String(entry?.lorebookName || '').trim(),
            uid: String(entry?.uid ?? '').trim(),
        }))
        .filter(entry => entry.content);
}

export function appendAdditionalContextSection(parts, entries = []) {
    const contextEntries = normalizeAdditionalContextEntries(entries);
    if (!Array.isArray(parts) || contextEntries.length === 0) {
        return;
    }

    parts.push('=== ADDITIONAL CONTEXT FOR REFERENCE ===');
    parts.push('These lorebook entries are reference material only. Do NOT rewrite or summarize them unless directly relevant to the requested output.');
    parts.push('');
    contextEntries.forEach((entry, index) => {
        const source = entry.lorebookName
            ? ` (${entry.lorebookName}${entry.uid ? ` #${entry.uid}` : ''})`
            : '';
        parts.push(`Reference ${index + 1} - ${entry.title}${source}:`);
        parts.push(entry.content);
        parts.push('');
    });
    parts.push('=== END ADDITIONAL CONTEXT ===');
    parts.push('');
}

export function buildMemoryPromptMessages(compiledScene, profile, worldInfo, stmbSettings = {}, additionalContextEntries = []) {
    return [{ role: 'user', content: buildMemoryPromptText(compiledScene, profile, worldInfo, stmbSettings, additionalContextEntries) }];
}

export function buildMemoryPromptText(compiledScene, profile, worldInfo, stmbSettings = {}, additionalContextEntries = []) {
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
    const contextEntries = normalizeAdditionalContextEntries(additionalContextEntries?.length ? additionalContextEntries : compiledScene?.additionalContextEntries);

    appendAdditionalContextSection(sceneLines, contextEntries);

    if (previousMemories.length > 0) {
        sceneLines.push('=== PREVIOUS SCENE CONTEXT (DO NOT PROCESS) ===');
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
        sceneLines.push('=== END PREVIOUS SCENE CONTEXT - PROCESS ONLY THE SCENE BELOW ===');
        sceneLines.push('');
    }

    sceneLines.push('=== SCENE TRANSCRIPT ===');
    sceneLines.push(...messageLines);
    sceneLines.push('');
    sceneLines.push('=== END SCENE ===');

    return `${presetPrompt}\n\n${sceneLines.join('\n')}`;
}

export function buildSidePromptText(templatePrompt, priorContent, compiledScene, responseFormat, previousMemories = [], runtimeMacros = {}, additionalContextEntries = []) {
    const parts = [];
    parts.push(applySidePromptMacros(templatePrompt, runtimeMacros));
    if (priorContent && String(priorContent).trim()) {
        parts.push('\n=== PRIOR ENTRY ===\n');
        parts.push(String(priorContent));
    }
    const contextLines = [];
    appendAdditionalContextSection(contextLines, additionalContextEntries?.length ? additionalContextEntries : compiledScene?.additionalContextEntries);
    if (contextLines.length > 0) {
        parts.push('\n');
        parts.push(contextLines.join('\n'));
    }
    if (previousMemories.length > 0) {
        parts.push('\n=== PREVIOUS SCENE CONTEXT (DO NOT PROCESS) ===\n');
        parts.push('These are previous memories for context only. Do NOT include them in your new output.\n\n');
        previousMemories.forEach((memory, index) => {
            parts.push(`Context ${index + 1} - ${memory.title || 'Memory'}:\n`);
            parts.push(`${memory.content || ''}\n`);
            if (Array.isArray(memory.keywords) && memory.keywords.length > 0) {
                parts.push(`Keywords: ${memory.keywords.join(', ')}\n`);
            }
            parts.push('\n');
        });
        parts.push('=== END PREVIOUS SCENE CONTEXT - PROCESS ONLY THE SCENE BELOW ===\n');
    }
    parts.push('\n=== SCENE TEXT ===\n');
    parts.push(compiledSceneToText(compiledScene));
    if (responseFormat && String(responseFormat).trim()) {
        parts.push('\n=== RESPONSE FORMAT ===\n');
        parts.push(applySidePromptMacros(responseFormat, runtimeMacros).trim());
    }
    return applyConfiguredStmbRegex(parts.join(''), 'selectedRegexOutgoing', 'STMB sideprompt outgoing regex');
}
