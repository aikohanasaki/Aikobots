import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fsPromises } from 'node:fs';

import express from 'express';
import showdown from 'showdown';
import storage from 'node-persist';

import { getAllUserHandles, getUserDirectories, requireAdminMiddleware, requireLoginMiddleware, toKey } from '../users.js';

const THREAD_ID = 'admin';
const THREAD_FILE_NAME = 'admin.jsonl';
const MESSAGE_LIMIT = 4000;

const markdownConverter = new showdown.Converter({
    emoji: true,
    literalMidWordUnderscores: true,
    parseImgDimensions: true,
    tables: true,
    underline: true,
    simpleLineBreaks: true,
    strikethrough: true,
    disableForced4SpacesIndentedSublists: true,
});

export const router = express.Router();

router.use(requireLoginMiddleware);

function getThreadFilePath(userHandle) {
    return path.join(getUserDirectories(userHandle).messages, THREAD_FILE_NAME);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;');
}

function renderMessageHtml(body) {
    return markdownConverter.makeHtml(escapeHtml(body)).trim();
}

function buildMessagePreview(body) {
    return String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function createMessageId() {
    return `m_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function getValidatedBody(body) {
    const normalized = String(body ?? '');
    const trimmed = normalized.trim();

    if (!trimmed) {
        return { error: 'Message body is required.' };
    }

    if (normalized.length > MESSAGE_LIMIT) {
        return { error: `Message body must be ${MESSAGE_LIMIT} characters or fewer.` };
    }

    return { body: normalized };
}

async function ensureMessagesDirectory(userHandle) {
    await fsPromises.mkdir(getUserDirectories(userHandle).messages, { recursive: true });
}

async function appendThreadRecord(userHandle, record) {
    const filePath = getThreadFilePath(userHandle);
    await ensureMessagesDirectory(userHandle);
    await fsPromises.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

async function appendThreadMetaIfMissing(userHandle) {
    const filePath = getThreadFilePath(userHandle);

    try {
        await fsPromises.access(filePath);
        return;
    } catch {
        // File does not exist yet.
    }

    await appendThreadRecord(userHandle, {
        type: 'thread_meta',
        threadId: THREAD_ID,
        userHandle,
        createdAt: Date.now(),
    });
}

async function parseThread(userHandle) {
    const filePath = getThreadFilePath(userHandle);
    const thread = {
        threadId: THREAD_ID,
        userHandle,
        createdAt: null,
        messages: [],
        unread: {
            forUser: false,
            forAdmins: false,
        },
        lastMessageAt: null,
        lastPreview: '',
    };

    let content = '';

    try {
        content = await fsPromises.readFile(filePath, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return thread;
        }

        throw error;
    }

    let latestUserMessageId = '';
    let latestAdminMessageId = '';
    let lastReadByUserMessageId = '';
    let lastReadByAdminsMessageId = '';

    for (const [index, line] of content.split(/\r?\n/).entries()) {
        const trimmedLine = line.trim();

        if (!trimmedLine) {
            continue;
        }

        let record;

        try {
            record = JSON.parse(trimmedLine);
        } catch (error) {
            console.warn(`Skipping malformed message record for ${userHandle} at line ${index + 1}`, error);
            continue;
        }

        if (record?.type === 'thread_meta') {
            thread.createdAt = Number(record.createdAt) || thread.createdAt;
            continue;
        }

        if (record?.type === 'message') {
            const message = {
                id: String(record.id || ''),
                senderHandle: String(record.senderHandle || ''),
                senderName: String(record.senderName || ''),
                senderRole: record.senderRole === 'admin' ? 'admin' : 'user',
                body: String(record.body || ''),
                createdAt: Number(record.createdAt) || Date.now(),
            };

            message.html = renderMessageHtml(message.body);
            thread.messages.push(message);
            thread.lastMessageAt = message.createdAt;
            thread.lastPreview = buildMessagePreview(message.body);

            if (message.senderRole === 'user') {
                latestUserMessageId = message.id;
            } else {
                latestAdminMessageId = message.id;
            }

            continue;
        }

        if (record?.type === 'read_marker') {
            const lastReadMessageId = String(record.lastReadMessageId || '');

            if (record.actorRole === 'user') {
                lastReadByUserMessageId = lastReadMessageId;
            }

            if (record.actorRole === 'admin') {
                lastReadByAdminsMessageId = lastReadMessageId;
            }
        }
    }

    thread.unread.forUser = Boolean(latestAdminMessageId) && latestAdminMessageId !== lastReadByUserMessageId;
    thread.unread.forAdmins = Boolean(latestUserMessageId) && latestUserMessageId !== lastReadByAdminsMessageId;

    return thread;
}

async function appendReadMarkerIfNeeded(userHandle, actorRole, actorHandle, thread) {
    const latestMessage = [...thread.messages].reverse().find(message => message.senderRole !== actorRole);

    if (!latestMessage?.id) {
        return;
    }

    await appendThreadRecord(userHandle, {
        type: 'read_marker',
        actorRole,
        actorHandle,
        lastReadMessageId: latestMessage.id,
        createdAt: Date.now(),
    });
}

async function getUserByHandle(userHandle) {
    return storage.getItem(toKey(userHandle));
}

async function getRegularUsers() {
    const handles = await getAllUserHandles();
    const users = await Promise.all(handles.map(async handle => {
        const user = await getUserByHandle(handle);
        return user ? { handle, user } : null;
    }));

    return users.filter(Boolean).filter(entry => !entry.user.admin);
}

router.get('/summary', async (request, response) => {
    try {
        if (request.user.profile.admin) {
            const users = await getRegularUsers();
            const threads = await Promise.all(users.map(({ handle }) => parseThread(handle)));
            const threadsWithUnread = threads.filter(thread => thread.unread.forAdmins).length;
            return response.json({
                hasUnread: threadsWithUnread > 0,
                threadsWithUnread,
            });
        }

        const thread = await parseThread(request.user.profile.handle);
        return response.json({
            hasUnread: thread.unread.forUser,
        });
    } catch (error) {
        console.error('Failed to load message summary', error);
        return response.sendStatus(500);
    }
});

router.get('/thread', async (request, response) => {
    try {
        if (request.user.profile.admin) {
            return response.status(403).json({ error: 'Admins must use the admin message endpoints.' });
        }

        let thread = await parseThread(request.user.profile.handle);
        await appendReadMarkerIfNeeded(request.user.profile.handle, 'user', request.user.profile.handle, thread);
        thread = await parseThread(request.user.profile.handle);
        return response.json(thread);
    } catch (error) {
        console.error('Failed to load message thread', error);
        return response.sendStatus(500);
    }
});

router.post('/thread', async (request, response) => {
    try {
        if (request.user.profile.admin) {
            return response.status(403).json({ error: 'Admins must use the admin message endpoints.' });
        }

        const validated = getValidatedBody(request.body?.body);

        if (validated.error) {
            return response.status(400).json({ error: validated.error });
        }

        await appendThreadMetaIfMissing(request.user.profile.handle);
        await appendThreadRecord(request.user.profile.handle, {
            type: 'message',
            id: createMessageId(),
            senderHandle: request.user.profile.handle,
            senderName: request.user.profile.name,
            senderRole: 'user',
            body: validated.body,
            createdAt: Date.now(),
        });

        return response.sendStatus(204);
    } catch (error) {
        console.error('Failed to send user message', error);
        return response.sendStatus(500);
    }
});

router.get('/admin/threads', requireAdminMiddleware, async (_request, response) => {
    try {
        const users = await getRegularUsers();
        const summaries = await Promise.all(users.map(async ({ handle, user }) => {
            const thread = await parseThread(handle);
            return {
                userHandle: handle,
                userName: user.name,
                lastMessageAt: thread.lastMessageAt,
                lastPreview: thread.lastPreview,
                hasUnread: thread.unread.forAdmins,
            };
        }));

        summaries.sort((a, b) => {
            const left = Number(b.lastMessageAt || 0) - Number(a.lastMessageAt || 0);
            if (left !== 0) {
                return left;
            }

            return String(a.userName).localeCompare(String(b.userName));
        });

        return response.json(summaries);
    } catch (error) {
        console.error('Failed to load admin message threads', error);
        return response.sendStatus(500);
    }
});

router.get('/admin/threads/:handle', requireAdminMiddleware, async (request, response) => {
    try {
        const handle = String(request.params.handle || '');
        const user = await getUserByHandle(handle);

        if (!user || user.admin) {
            return response.status(404).json({ error: 'User not found.' });
        }

        let thread = await parseThread(handle);
        await appendReadMarkerIfNeeded(handle, 'admin', request.user.profile.handle, thread);
        thread = await parseThread(handle);
        return response.json(thread);
    } catch (error) {
        console.error('Failed to load admin message thread', error);
        return response.sendStatus(500);
    }
});

router.post('/admin/threads/:handle', requireAdminMiddleware, async (request, response) => {
    try {
        const handle = String(request.params.handle || '');
        const user = await getUserByHandle(handle);

        if (!user || user.admin) {
            return response.status(404).json({ error: 'User not found.' });
        }

        const validated = getValidatedBody(request.body?.body);

        if (validated.error) {
            return response.status(400).json({ error: validated.error });
        }

        await appendThreadMetaIfMissing(handle);
        await appendThreadRecord(handle, {
            type: 'message',
            id: createMessageId(),
            senderHandle: request.user.profile.handle,
            senderName: request.user.profile.name,
            senderRole: 'admin',
            body: validated.body,
            createdAt: Date.now(),
        });

        return response.sendStatus(204);
    } catch (error) {
        console.error('Failed to send admin message', error);
        return response.sendStatus(500);
    }
});
