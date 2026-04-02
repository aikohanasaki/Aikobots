import {
    eventSource,
    event_types,
} from '../script.js';

const activeTasks = new Set();

export class StmbAbortError extends Error {
    constructor(reason = 'stmb-stop') {
        super('STMB operation stopped');
        this.name = 'StmbAbortError';
        this.code = 'STMB_ABORTED';
        this.reason = String(reason || 'stmb-stop');
        this.isStmbAbort = true;
    }
}

function cleanupTask(task) {
    if (!task || task.cleaned) {
        return;
    }

    task.cleaned = true;
    activeTasks.delete(task);
    eventSource.removeListener(event_types.GENERATION_STOPPED, task.stopHook);
}

export function createStmbTask(label = 'STMB') {
    const controller = new AbortController();
    const task = {
        label: String(label || 'STMB'),
        controller,
        signal: controller.signal,
        cleaned: false,
        stopHook: null,
        abort(reason = 'stmb-stop') {
            if (!controller.signal.aborted) {
                controller.abort(String(reason || 'stmb-stop'));
            }
        },
        cleanup() {
            cleanupTask(task);
        },
        throwIfAborted() {
            throwIfStmbAborted(controller.signal);
        },
    };

    task.stopHook = () => task.abort('generation-stopped');
    eventSource.once(event_types.GENERATION_STOPPED, task.stopHook);
    controller.signal.addEventListener('abort', () => cleanupTask(task), { once: true });
    activeTasks.add(task);
    return task;
}

export function stopAllStmbTasks(reason = 'stmb-stop') {
    const tasks = Array.from(activeTasks);
    for (const task of tasks) {
        task.abort(reason);
    }

    return { stoppedCount: tasks.length };
}

export function getActiveStmbTaskCount() {
    return activeTasks.size;
}

export function hasActiveStmbTasks() {
    return activeTasks.size > 0;
}

export function throwIfStmbAborted(signal) {
    if (signal?.aborted) {
        throw new StmbAbortError(signal.reason || 'stmb-stop');
    }
}

export function isStmbAbortError(error) {
    if (!error) {
        return false;
    }

    if (error instanceof StmbAbortError || error?.isStmbAbort === true || error?.code === 'STMB_ABORTED') {
        return true;
    }

    if (error?.name === 'AbortError') {
        return true;
    }

    const message = String(error?.message || '');
    return /generation-stopped|stmb-stop|operation stopped|aborted/i.test(message);
}
