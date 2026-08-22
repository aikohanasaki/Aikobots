/** Creates an event signal for generation admission and terminal state changes. */
export function createGenerationReadinessSignal() {
    const waiters = new Set();
    return {
        wait() {
            return new Promise(resolve => waiters.add(resolve));
        },
        notify() {
            const pending = [...waiters];
            waiters.clear();
            pending.forEach(resolve => resolve());
        },
    };
}

/** Waits until the active foreground generation is durable or has ended. */
export async function waitForGenerationReadiness({ isActive, getGenerationId, signal }) {
    while (isActive() && !getGenerationId()) {
        await signal.wait();
    }
    return getGenerationId();
}
