/**
 * Tracks the latest asynchronous task and lets callers wait through replacements.
 */
export class LatestTask {
    #sequence = 0;
    /** @type {Promise<unknown>|null} */
    #activePromise = null;

    /**
     * Starts a task as the latest task.
     * @template T
     * @param {(id: number) => Promise<T>} task Task factory
     * @returns {Promise<T>} Task result
     */
    async start(task) {
        const id = ++this.#sequence;
        const promise = task(id);
        this.#activePromise = promise;

        try {
            return await promise;
        } finally {
            if (this.#activePromise === promise) {
                this.#activePromise = null;
            }
        }
    }

    /**
     * Returns whether an id belongs to the latest task.
     * @param {number} id Task id
     * @returns {boolean} Whether the task is latest
     */
    isLatest(id) {
        return id === this.#sequence;
    }

    /**
     * Waits for the latest task, including a replacement started while waiting.
     */
    async wait() {
        while (this.#activePromise) {
            const pendingPromise = this.#activePromise;
            await pendingPromise;
            if (this.#activePromise === pendingPromise) {
                return;
            }
        }
    }
}
