let draining = false;
const activeTasks = new Set();

/** Starts and tracks generation work unless this process is already draining. */
export function startTrackedGenerationTask(startTask) {
    if (draining) {
        return null;
    }

    const task = Promise.resolve(startTask());
    activeTasks.add(task);
    void task.then(
        () => activeTasks.delete(task),
        () => activeTasks.delete(task),
    );
    return task;
}

/** Stops new generation work and waits for every task already owned by this process. */
export async function drainGenerationTasks() {
    draining = true;
    await Promise.allSettled([...activeTasks]);
}
