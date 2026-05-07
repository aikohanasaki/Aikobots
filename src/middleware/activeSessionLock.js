import express from 'express';

import { activeSessionStore, isActiveSessionError, sendActiveSessionRequired } from '../active-session-store.js';

const READ_ONLY_POST_ROUTES = [
    /^\/api\/active-session\/(?:status|claim|take-over|heartbeat|release)$/,
    /^\/api\/ping$/,
    /^\/api\/users\/(?:logout|get|slugify)$/,
    /^\/api\/assets\/(?:get|character)$/,
    /^\/api\/avatars\/get$/,
    /^\/api\/backgrounds\/all$/,
    /^\/api\/backups\/chat\/(?:list|download)$/,
    /^\/api\/backends\/chat-completions\/(?:status|bias)$/,
    /^\/api\/characters\/(?:all|get|chats|export|repush-blacklist\/list|distribution-policy)$/,
    /^\/api\/chats\/(?:get|group\/get|search|orphaned|recent|export)$/,
    /^\/api\/extra\/classify(?:\/labels)?$/,
    /^\/api\/files\/(?:sanitize-filename|verify)$/,
    /^\/api\/groups\/all$/,
    /^\/api\/horde\/(?:sd-samplers|sd-models|user-info)$/,
    /^\/api\/images\/(?:list(?:\/.*)?|folders)$/,
    /^\/api\/openrouter\/models\/(?:providers|multimodal|embedding)$/,
    /^\/api\/settings\/(?:get|get-snapshots|load-snapshot)$/,
    /^\/api\/secrets\/(?:read|view|find)$/,
    /^\/api\/sd\/(?:ping|upscalers|vaes|samplers|schedulers|models|get-model|sd-next\/upscalers)$/,
    /^\/api\/stats\/get$/,
    /^\/api\/stmb\/chat-range-info$/,
    /^\/api\/tokenizers\/.+\/(?:encode|decode|count)$/,
    /^\/api\/worldinfo\/(?:list|get|hidden-templates\/get|sorted-entries|timed-effects\/recompute)$/,
    /^\/api\/vector\/(?:query|query-multi|list)$/,
];

function isReadOnlyRoute(request) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        return true;
    }

    if (request.method !== 'POST') {
        return false;
    }

    return READ_ONLY_POST_ROUTES.some(pattern => pattern.test(request.path));
}

export const activeSessionRouter = express.Router();

activeSessionRouter.post('/status', async (request, response) => {
    try {
        const browserSessionId = activeSessionStore.getBrowserSessionId(request);
        const status = await activeSessionStore.getStatus(request.user.profile.handle, browserSessionId);
        return response.json(status);
    } catch (error) {
        console.error('Failed to get active browser session status:', error);
        return response.sendStatus(error.status || 500);
    }
});

activeSessionRouter.post('/claim', async (request, response) => {
    try {
        const browserSessionId = activeSessionStore.getBrowserSessionId(request);
        const metadata = activeSessionStore.getMetadata(request);
        const status = await activeSessionStore.claim(request.user.profile.handle, browserSessionId, metadata);
        return response.json(status);
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }

        console.error('Failed to claim active browser session:', error);
        return response.sendStatus(error.status || 500);
    }
});

activeSessionRouter.post('/take-over', async (request, response) => {
    try {
        const browserSessionId = activeSessionStore.getBrowserSessionId(request);
        const metadata = activeSessionStore.getMetadata(request);
        const status = await activeSessionStore.takeOver(request.user.profile.handle, browserSessionId, metadata);
        return response.json(status);
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }

        console.error('Failed to take over active browser session:', error);
        return response.sendStatus(error.status || 500);
    }
});

activeSessionRouter.post('/heartbeat', async (request, response) => {
    try {
        const browserSessionId = activeSessionStore.getBrowserSessionId(request);
        const status = await activeSessionStore.heartbeat(request.user.profile.handle, browserSessionId);
        return response.json(status);
    } catch (error) {
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }

        console.error('Failed to heartbeat active browser session:', error);
        return response.sendStatus(error.status || 500);
    }
});

activeSessionRouter.post('/release', async (request, response) => {
    try {
        const browserSessionId = activeSessionStore.getBrowserSessionId(request);
        const released = await activeSessionStore.release(request.user.profile.handle, browserSessionId);
        return response.json({ released });
    } catch (error) {
        console.error('Failed to release active browser session:', error);
        return response.sendStatus(error.status || 500);
    }
});

export async function activeSessionLockMiddleware(request, response, next) {
    if (isReadOnlyRoute(request)) {
        return next();
    }

    const userHandle = request.user.profile.handle;
    const browserSessionId = activeSessionStore.getBrowserSessionId(request);
    let operation = null;
    let ended = false;
    let cancellationTimer = null;
    const operationAbortController = new AbortController();

    const endOperation = () => {
        if (ended || !operation) {
            return;
        }

        ended = true;
        if (cancellationTimer) {
            clearInterval(cancellationTimer);
        }

        activeSessionStore.endOperation(userHandle, browserSessionId, operation.operationId)
            .catch(error => console.error('Failed to end active-session operation:', error));
    };

    try {
        operation = await activeSessionStore.beginOperation(userHandle, browserSessionId, `${request.method} ${request.path}`);
        request.activeSessionOperation = {
            operationId: operation.operationId,
            browserSessionId,
            operationType: operation.operationType,
            signal: operationAbortController.signal,
            assertAllowed: () => activeSessionStore.assertOperationAllowed(userHandle, browserSessionId, operation.operationId),
        };

        cancellationTimer = setInterval(async () => {
            try {
                await request.activeSessionOperation.assertAllowed();
            } catch (error) {
                if (isActiveSessionError(error)) {
                    operationAbortController.abort(error);
                    if (!response.headersSent) {
                        sendActiveSessionRequired(response);
                    } else if (!response.writableEnded) {
                        response.end();
                    }

                    endOperation();
                    return;
                }

                console.error('Failed to verify in-flight active-session operation:', error);
            }
        }, 1_000);
        cancellationTimer.unref?.();

        response.once('finish', endOperation);
        response.once('close', endOperation);
        return next();
    } catch (error) {
        endOperation();
        if (isActiveSessionError(error)) {
            return sendActiveSessionRequired(response);
        }

        console.error('Failed to verify active browser session:', error);
        return response.sendStatus(error.status || 500);
    }
}
