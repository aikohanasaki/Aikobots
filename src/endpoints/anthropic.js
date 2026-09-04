import fetch from 'node-fetch';
import express from 'express';

import { readSecret, SECRET_KEYS } from './secrets.js';
import { CLAUDE_API_VERSION } from '../claude.js';

export const router = express.Router();

router.post('/caption-image', async (request, response) => {
    try {
        const mimeType = request.body.image.split(';')[0].split(':')[1];
        const base64Data = request.body.image.split(',')[1];
        const baseUrl = request.body.reverse_proxy ? request.body.reverse_proxy : 'https://api.anthropic.com/v1';
        const url = `${baseUrl}/messages`;
        const body = {
            model: request.body.model,
            messages: [
                {
                    'role': 'user', 'content': [
                        {
                            'type': 'image',
                            'source': {
                                'type': 'base64',
                                'media_type': mimeType,
                                'data': base64Data,
                            },
                        },
                        { 'type': 'text', 'text': request.body.prompt },
                    ],
                },
            ],
            max_tokens: 4096,
        };
        const apiKey = request.body.reverse_proxy ? request.body.proxy_password : readSecret(request.user.directories, SECRET_KEYS.CLAUDE);

        const result = await fetch(url, {
            body: JSON.stringify(body),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': CLAUDE_API_VERSION,
                ...(apiKey ? { 'x-api-key': apiKey } : {}),
            },
        });

        if (!result.ok) {
            console.warn(`Claude API returned error: ${result.status} ${result.statusText}`);
            return response.status(result.status).send({ error: true });
        }

        /** @type {any} */
        const generateResponseJson = await result.json();
        const caption = generateResponseJson.content?.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('') || '';

        if (!caption) {
            return response.status(500).send('No caption found');
        }

        return response.json({ caption });
    } catch (error) {
        console.error(error);
        response.status(500).send('Internal server error');
    }
});
