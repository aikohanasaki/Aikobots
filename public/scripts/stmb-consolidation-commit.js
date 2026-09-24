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
    if (result.recoveryId) checkpoint.recoveryIds = [...new Set([...(checkpoint.recoveryIds || []), result.recoveryId])];
    checkpoint.pending = null;
    persist();
    return result;
}

/** Retains only the originating chat identity needed for post-save recovery. */
export function buildConsolidationRecoveryContext(scene, runId) {
    const ref = scene?.chatRef;
    const sceneContext = scene?.chatId && (ref?.type === 'group' || ref?.type === 'character' && ref.avatarUrl)
        ? { chatId: scene.chatId, chatRef: ref.type === 'group'
            ? { type: 'group', chatId: ref.chatId }
            : { type: 'character', avatarUrl: ref.avatarUrl, fileName: ref.fileName },
        ...(ref.type === 'group' ? { groupId: String(scene.groupId || '') } : {}) }
        : null;
    return { runId, sceneContext };
}

/** Excludes both saved and explicitly rejected sources when a preview job resumes. */
export function getConsolidationConsumedIds(checkpoint) {
    return new Set([
        ...(checkpoint.rejectedIds || []),
        ...checkpoint.completedCandidates.flatMap(candidate => candidate.memberIds || []),
    ].map(String));
}
