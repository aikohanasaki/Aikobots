/** Retains an exact pending write and checkpoints acknowledged batches before post-save effects. */
export async function saveConsolidationBatch(checkpoint, request, { send, persist }) {
    if (!checkpoint.pending) {
        checkpoint.pending = structuredClone(request);
        persist();
    }
    const pending = checkpoint.pending;
    const result = await send(pending);
    checkpoint.completedEntries.push(...(result.createdEntries || []));
    checkpoint.completedCandidates.push(...pending.summaryCandidates);
    checkpoint.pending = null;
    persist();
    return result;
}

/** Excludes both saved and explicitly rejected sources when a preview job resumes. */
export function getConsolidationConsumedIds(checkpoint) {
    return new Set([
        ...(checkpoint.rejectedIds || []),
        ...checkpoint.completedCandidates.flatMap(candidate => candidate.memberIds || []),
    ].map(String));
}
