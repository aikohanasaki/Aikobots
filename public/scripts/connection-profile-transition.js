import { LatestTask } from './util/LatestTask.js';

const transitionTasks = new LatestTask();

let requestedProfileId = '';
let settledProfileId = '';
let latestTransitionError = null;
let transitionPending = false;
/** @type {Promise<unknown>|null} */
let operationTail = null;

/**
 * Runs a connection-profile transition and commits only the latest result.
 * @template T
 * @param {string} profileId Requested profile id, or an empty string for no profile
 * @param {(isLatest: () => boolean) => Promise<T>} operation Profile application operation
 * @param {(result: T) => Promise<void>} [onSettled] Latest-only completion callback
 * @returns {Promise<T|null>} Latest result, or null when superseded
 */
export function runConnectionProfileTransition(profileId, operation, onSettled) {
    requestedProfileId = String(profileId || '');
    latestTransitionError = null;
    transitionPending = true;
    const previousOperation = operationTail;

    const transition = transitionTasks.start(async transitionId => {
        if (previousOperation) {
            await previousOperation.catch(() => null);
        }
        if (!transitionTasks.isLatest(transitionId)) {
            return null;
        }

        try {
            const result = await operation(() => transitionTasks.isLatest(transitionId));
            if (!transitionTasks.isLatest(transitionId)) {
                return null;
            }

            settledProfileId = requestedProfileId;
            latestTransitionError = null;
            await onSettled?.(result);
            return result;
        } catch (error) {
            if (!transitionTasks.isLatest(transitionId)) {
                return null;
            }

            settledProfileId = '';
            latestTransitionError = error instanceof Error ? error : new Error('Connection profile transition failed.');
            throw latestTransitionError;
        } finally {
            if (transitionTasks.isLatest(transitionId)) {
                transitionPending = false;
            }
        }
    });
    operationTail = transition;
    void transition.then(clearOperationTail, clearOperationTail);
    return transition;

    function clearOperationTail() {
        if (operationTail === transition) {
            operationTail = null;
        }
    }
}

/** Waits for the latest connection-profile transition, including replacements. */
export async function waitForCurrentConnectionProfileTransition() {
    while (transitionPending) {
        try {
            await transitionTasks.wait();
        } catch {
            // The safe, latest error is rethrown below after replacement handling settles.
        }
    }

    if (latestTransitionError) {
        throw latestTransitionError;
    }
}

/**
 * Returns whether a profile is selected, settled, and not being replaced.
 * @param {string} profileId Profile id
 */
export function isConnectionProfileSettled(profileId) {
    const normalizedProfileId = String(profileId || '');
    return !transitionPending
        && !latestTransitionError
        && requestedProfileId === normalizedProfileId
        && settledProfileId === normalizedProfileId;
}

/** Returns whether a connection-profile transition is in progress. */
export function isConnectionProfileTransitionPending() {
    return transitionPending;
}
