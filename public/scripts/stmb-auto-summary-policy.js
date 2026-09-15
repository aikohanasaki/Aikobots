/** Counts an authoritative eligible scene and rejects work superseded during capture/counting. */
export async function evaluateStmbAutoSummary({ settings, highest, last, capture, countTokens, isCurrent }) {
    const buffer = Math.max(0, Math.min(50, Math.trunc(Number(settings.autoSummaryBuffer) || 0)));
    const range = { sceneStart: highest + 1, sceneEnd: last - buffer };
    if (range.sceneStart > range.sceneEnd || !isCurrent()) return null;
    if (settings.autoSummaryTriggerMode !== 'tokens') {
        return last - highest >= Number(settings.autoSummaryInterval || 50) + buffer ? { range } : null;
    }
    const captured = await capture(range);
    if (!isCurrent() || !captured?.compiledScene?.messages?.length) return null;
    const count = await countTokens(captured.compiledScene);
    if (!isCurrent() || !Number.isFinite(count) || count < settings.autoSummaryTokenThreshold) return null;
    return { range, captured };
}
