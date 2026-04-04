import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';

import express from 'express';
import sanitize from 'sanitize-filename';

import {
    PUBLISH_MODES,
    SUBMISSION_STATUSES,
    SUBMISSION_CLEANUP_MODES,
    canAccessSubmission,
    cleanupSubmission,
    createCharacterSubmission,
    buildSubmissionSummary,
    distributeCharacterFile,
    ensureSubmissionStore,
    getSubmissionPaths,
    getSubmissionRecord,
    listSubmissionRecords,
    persistCharacterSubmissionOwner,
    writeSubmissionRecord,
} from '../character-submissions.js';
import { requireAdminMiddleware } from '../users.js';

export const router = express.Router();

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

async function isPngFile(filePath) {
    const fileHandle = await fsPromises.open(filePath, 'r');

    try {
        const header = Buffer.alloc(PNG_SIGNATURE.length);
        const { bytesRead } = await fileHandle.read(header, 0, header.length, 0);
        return bytesRead === PNG_SIGNATURE.length && header.equals(PNG_SIGNATURE);
    } finally {
        await fileHandle.close();
    }
}

router.post('/submit', async (request, response) => {
    const uploadPath = request.file?.path || (request.file?.destination && request.file?.filename ? path.join(request.file.destination, request.file.filename) : '');

    try {
        if (!request.file && !request.body?.sourceAvatar) {
            return response.status(400).json({ error: 'Missing character source.' });
        }

        let sourcePath = uploadPath;
        let originalFilename = request.file?.originalname;

        if (request.file) {
            if (!uploadPath) {
                return response.status(400).json({ error: 'Uploaded file could not be processed.' });
            }

            if (!(await isPngFile(uploadPath))) {
                return response.status(400).json({ error: 'Only PNG character cards are supported.' });
            }
        } else {
            const sourceAvatar = sanitize(String(request.body?.sourceAvatar || ''));
            if (!sourceAvatar) {
                return response.status(400).json({ error: 'Missing source character.' });
            }

            if (!sourceAvatar.toLowerCase().endsWith('.png')) {
                return response.status(400).json({ error: 'Only PNG character cards are supported.' });
            }

            sourcePath = path.join(request.user.directories.characters, sourceAvatar);
            if (!fs.existsSync(sourcePath)) {
                return response.status(404).json({ error: 'Source character was not found.' });
            }

            if (!(await isPngFile(sourcePath))) {
                return response.status(400).json({ error: 'Only PNG character cards are supported.' });
            }

            originalFilename = sourceAvatar;
        }

        const record = await createCharacterSubmission({
            uploadPath: sourcePath,
            ownerHandle: request.user.profile.handle,
            originalFilename,
        });

        if (!request.file) {
            await persistCharacterSubmissionOwner({
                filePath: sourcePath,
                ownerHandle: request.user.profile.handle,
            });
        }

        return response.json({
            id: record.id,
            status: record.status,
            ownerHandle: record.ownerHandle,
            submittedFilename: record.submittedFilename,
        });
    } catch (error) {
        console.error('Character submission failed:', error);
        return response.status(400).json({ error: error.message || 'Character submission failed.' });
    } finally {
        if (uploadPath) {
            await fsPromises.rm(uploadPath, { force: true }).catch(() => { });
        }
    }
});

router.post('/list', async (request, response) => {
    try {
        await ensureSubmissionStore();
        const statusFilter = String(request.body?.status || '').trim();
        const records = await listSubmissionRecords();

        const visibleRecords = records.filter(record => {
            if (!canAccessSubmission(record, request.user.profile)) {
                return false;
            }

            if (!request.user.profile.admin) {
                return true;
            }

            return !statusFilter || record.status === statusFilter;
        });

        const summaries = await Promise.all(visibleRecords.map(async record => ({
            ...(await buildSubmissionSummary(record)),
            previewUrl: `/api/character-submissions/file/${encodeURIComponent(record.id)}`,
        })));

        return response.json(summaries);
    } catch (error) {
        console.error('Character submission list failed:', error);
        return response.sendStatus(500);
    }
});

router.get('/file/:id', async (request, response) => {
    try {
        const record = await getSubmissionRecord(String(request.params.id || ''));
        if (!canAccessSubmission(record, request.user.profile)) {
            return response.sendStatus(403);
        }

        const { cardPath } = getSubmissionPaths(record.id);
        return response.type('png').sendFile(path.resolve(cardPath));
    } catch (error) {
        console.error('Character submission preview failed:', error);
        return response.sendStatus(404);
    }
});

router.post('/review', requireAdminMiddleware, async (request, response) => {
    try {
        const submissionId = String(request.body?.id || '').trim();
        const action = String(request.body?.action || '').trim();
        const reviewNote = String(request.body?.reviewNote || '');

        if (!submissionId) {
            return response.status(400).json({ error: 'Missing submission id.' });
        }

        const record = await getSubmissionRecord(submissionId);
        if (record.status !== SUBMISSION_STATUSES.PENDING) {
            return response.status(409).json({ error: 'This submission has already been reviewed.' });
        }

        if (action === 'reject') {
            record.status = SUBMISSION_STATUSES.REJECTED;
            record.reviewedAt = Date.now();
            record.reviewedBy = request.user.profile.handle;
            record.reviewNote = reviewNote;
            record.publishMode = null;
            record.targetHandles = [];
            record.publishedFilename = null;
            await writeSubmissionRecord(record);

            return response.json(await buildSubmissionSummary(record));
        }

        if (action !== 'approve') {
            return response.status(400).json({ error: 'Invalid review action.' });
        }

        const publishMode = String(request.body?.publishMode || '').trim();
        if (![PUBLISH_MODES.SELECTED, PUBLISH_MODES.GLOBAL].includes(publishMode)) {
            return response.status(400).json({ error: 'Invalid publish mode.' });
        }

        const { cardPath } = getSubmissionPaths(record.id);
        const distribution = await distributeCharacterFile({
            sourcePath: cardPath,
            publishedFilename: request.body?.publishedFilename,
            publishMode,
            targetHandles: request.body?.targetHandles,
            actingUserHandle: request.user.profile.handle,
        });

        record.status = SUBMISSION_STATUSES.APPROVED;
        record.reviewedAt = Date.now();
        record.reviewedBy = request.user.profile.handle;
        record.reviewNote = reviewNote;
        record.publishMode = publishMode;
        record.targetHandles = distribution.targetHandles;
        record.publishedFilename = distribution.publishedFilename;
        await writeSubmissionRecord(record);

        return response.json(await buildSubmissionSummary(record));
    } catch (error) {
        console.error('Character submission review failed:', error);
        return response.status(400).json({ error: error.message || 'Character review failed.' });
    }
});

router.post('/cleanup', requireAdminMiddleware, async (request, response) => {
    try {
        const submissionId = String(request.body?.id || '').trim();
        const deleteMode = String(request.body?.deleteMode || '').trim();

        if (!submissionId) {
            return response.status(400).json({ error: 'Missing submission id.' });
        }

        if (![SUBMISSION_CLEANUP_MODES.ASSET, SUBMISSION_CLEANUP_MODES.ALL].includes(deleteMode)) {
            return response.status(400).json({ error: 'Invalid cleanup mode.' });
        }

        const record = await getSubmissionRecord(submissionId);
        await cleanupSubmission({ submissionId, deleteMode });

        if (deleteMode === SUBMISSION_CLEANUP_MODES.ALL) {
            return response.json({
                id: submissionId,
                deleted: true,
                deleteMode,
            });
        }

        return response.json({
            ...(await buildSubmissionSummary(record)),
            deleted: false,
            deleteMode,
        });
    } catch (error) {
        console.error('Character submission cleanup failed:', error);
        return response.status(400).json({ error: error.message || 'Character submission cleanup failed.' });
    }
});
