import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fsPromises } from 'node:fs';

import { getUserDirectories } from './users.js';

export const USER_ADMIN_THREAD_ID = 'admin';
export const USER_ADMIN_THREAD_FILE_NAME = 'admin.jsonl';

/**
 * Gets the admin thread file path for a user.
 * @param {string} userHandle
 * @returns {string}
 */
export function getUserAdminThreadFilePath(userHandle) {
    return path.join(getUserDirectories(userHandle).messages, USER_ADMIN_THREAD_FILE_NAME);
}

/**
 * Creates a unique message id for the user/admin inbox.
 * @returns {string}
 */
export function createUserAdminMessageId() {
    return `m_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function ensureUserAdminMessagesDirectory(userHandle) {
    await fsPromises.mkdir(getUserDirectories(userHandle).messages, { recursive: true });
}

/**
 * Appends a raw record to the user/admin thread file.
 * @param {string} userHandle
 * @param {object} record
 * @returns {Promise<void>}
 */
export async function appendUserAdminThreadRecord(userHandle, record) {
    const filePath = getUserAdminThreadFilePath(userHandle);
    await ensureUserAdminMessagesDirectory(userHandle);
    await fsPromises.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Ensures a thread metadata record exists for the user's admin thread.
 * @param {string} userHandle
 * @returns {Promise<void>}
 */
export async function appendUserAdminThreadMetaIfMissing(userHandle) {
    const filePath = getUserAdminThreadFilePath(userHandle);
    const threadMetaRecord = `${JSON.stringify({
        type: 'thread_meta',
        threadId: USER_ADMIN_THREAD_ID,
        userHandle,
        createdAt: Date.now(),
    })}\n`;

    await ensureUserAdminMessagesDirectory(userHandle);

    let handle;

    try {
        handle = await fsPromises.open(filePath, 'wx');
        await handle.writeFile(threadMetaRecord, 'utf8');
    } catch (error) {
        if (error?.code !== 'EEXIST') {
            throw error;
        }
    } finally {
        await handle?.close();
    }
}

/**
 * Appends a user-authored message to the user's admin thread.
 * @param {{ userHandle: string, senderHandle: string, senderName: string, body: string, createdAt?: number }} params
 * @returns {Promise<void>}
 */
export async function appendUserAdminUserMessage({
    userHandle,
    senderHandle,
    senderName,
    body,
    createdAt = Date.now(),
}) {
    await appendUserAdminThreadMetaIfMissing(userHandle);
    await appendUserAdminThreadRecord(userHandle, {
        type: 'message',
        id: createUserAdminMessageId(),
        senderHandle,
        senderName,
        senderRole: 'user',
        body,
        createdAt,
    });
}
