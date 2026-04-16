import express from 'express';
import sanitize from 'sanitize-filename';

import { setCharacterFavorite, setGroupFavorite } from '../favorites-repository.js';

export const router = express.Router();

function coerceFavoriteValue(value) {
    return value === true || value === 'true';
}

router.post('/set', async function (request, response) {
    try {
        const entityType = String(request.body?.entityType || '').trim();
        const value = coerceFavoriteValue(request.body?.value);

        if (entityType === 'character') {
            const avatar = String(request.body?.avatar || '').trim();
            const sharedCharacterKey = String(request.body?.sharedCharacterKey || '').trim();

            if (!avatar || avatar !== sanitize(avatar)) {
                return response.status(400).json({ error: 'A valid character avatar is required.' });
            }

            setCharacterFavorite(request.user.directories, {
                avatar,
                sharedCharacterKey,
                value,
            });

            return response.send({ ok: true, value });
        }

        if (entityType === 'group') {
            const id = String(request.body?.id || '').trim();
            if (!id) {
                return response.status(400).json({ error: 'A valid group id is required.' });
            }

            await setGroupFavorite(request.user.directories, { id, value });
            return response.send({ ok: true, value });
        }

        return response.status(400).json({ error: 'Unsupported favorite entity type.' });
    } catch (error) {
        console.error('Failed to update favorite state.', error);
        return response.status(500).json({ error: 'Failed to update favorite state.' });
    }
});
