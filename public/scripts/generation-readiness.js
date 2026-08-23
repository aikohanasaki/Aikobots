/** Creates an event signal for generation admission and terminal state changes. */
export function createGenerationReadinessSignal() {
    const waiters = new Set();
    return {
        wait(timeout) {
            return new Promise(resolve => {
                let timeoutId;
                const finish = () => {
                    waiters.delete(finish);
                    clearTimeout(timeoutId);
                    resolve();
                };
                waiters.add(finish);
                if (Number.isFinite(timeout)) {
                    timeoutId = setTimeout(finish, Math.max(0, timeout));
                }
            });
        },
        notify() {
            const pending = [...waiters];
            waiters.clear();
            pending.forEach(resolve => resolve());
        },
    };
}

/** Waits until the active foreground generation is durable or has ended. */
export async function waitForGenerationReadiness({ isActive, getGenerationId, signal, timeout = Infinity }) {
    const deadline = Number.isFinite(timeout) ? Date.now() + Math.max(0, timeout) : Infinity;
    while (isActive() && !getGenerationId()) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            return '';
        }
        await signal.wait(remaining);
    }
    return getGenerationId();
}

/** Waits for foreground completion and group cleanup under one deadline. */
export async function waitForGenerationSettlement({ foregroundPromise, isGroupActive, timeout, interval = 25 }) {
    const deadline = Date.now() + Math.max(0, timeout);
    if (foregroundPromise) {
        const remaining = deadline - Date.now();
        if (remaining <= 0 || !await settlePromiseBefore(foregroundPromise, remaining)) {
            return false;
        }
    }

    while (isGroupActive()) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(1, interval), remaining)));
    }
    return true;
}

/** Settles a promise rejection as completion without leaving a live timeout behind. */
function settlePromiseBefore(promise, timeout) {
    return new Promise(resolve => {
        let finished = false;
        const finish = value => {
            if (finished) {
                return;
            }
            finished = true;
            clearTimeout(timeoutId);
            resolve(value);
        };
        const timeoutId = setTimeout(() => finish(false), timeout);
        Promise.resolve(promise).then(() => finish(true), () => finish(true));
    });
}
