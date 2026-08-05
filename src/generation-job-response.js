import { EventEmitter } from 'node:events';

import {
    appendGenerationEvent,
    setGenerationJobResponseHeaders,
    setGenerationJobResult,
    touchGenerationJob,
} from './generation-job-store.js';

const SAFE_RESPONSE_HEADERS = new Set([
    'content-type',
    'x-request-id',
    'x-st-messages-count',
    'x-st-first-included-message-id',
]);

function getSafeHeaders(headers) {
    return Object.fromEntries([...headers].filter(([name]) => SAFE_RESPONSE_HEADERS.has(name)));
}

/**
 * Minimal Express response sink that durably records provider output for replay.
 */
export class GenerationJobResponse extends EventEmitter {
    constructor(id, userHandle, stream) {
        super();
        this.id = id;
        this.userHandle = userHandle;
        this.stream = Boolean(stream);
        this.socket = new EventEmitter();
        this.statusCode = 200;
        this.statusMessage = 'OK';
        this.headersSent = false;
        this.writableEnded = false;
        this.failed = false;
        this.hasDoneEvent = false;
        this.buffer = '';
        this.headers = new Map();
    }

    status(code) {
        this.statusCode = Number(code) || 500;
        this.failed ||= this.statusCode >= 400;
        return this;
    }

    setHeader(name, value) {
        this.headers.set(String(name).toLowerCase(), String(value));
        return this;
    }

    getHeader(name) {
        return this.headers.get(String(name).toLowerCase());
    }

    flushHeaders() {
        this.headersSent = true;
        setGenerationJobResponseHeaders(this.id, this.userHandle, getSafeHeaders(this.headers));
    }

    flush() {}

    write(chunk) {
        if (this.writableEnded) {
            return false;
        }

        this.headersSent = true;
        this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
        this.#drainEvents(false);
        return true;
    }

    send(payload) {
        if (this.writableEnded) {
            return this;
        }

        this.headersSent = true;
        setGenerationJobResponseHeaders(this.id, this.userHandle, getSafeHeaders(this.headers));
        this.failed ||= this.statusCode >= 400 || Boolean(payload?.error);
        if (this.stream) {
            this.#appendEvent(`data: ${JSON.stringify(payload)}`);
        } else {
            setGenerationJobResult(this.id, this.userHandle, payload);
        }
        this.writableEnded = true;
        this.emit('finish');
        return this;
    }

    json(payload) {
        return this.send(payload);
    }

    sendStatus(code) {
        return this.status(code).send({ error: true });
    }

    end(chunk) {
        if (chunk !== undefined) {
            this.write(chunk);
        }
        if (this.writableEnded) {
            return this;
        }

        this.#drainEvents(true);
        setGenerationJobResponseHeaders(this.id, this.userHandle, getSafeHeaders(this.headers));
        this.writableEnded = true;
        this.emit('finish');
        return this;
    }

    ensureDoneEvent() {
        if (!this.stream || this.hasDoneEvent) {
            return;
        }

        if (this.buffer.trim()) {
            this.#appendEvent(this.buffer.trim());
            this.buffer = '';
        }
        this.#appendEvent('data: [DONE]');
    }

    #drainEvents(flushRemainder) {
        this.buffer = this.buffer.replace(/\r\n/g, '\n');
        let delimiter;
        while ((delimiter = this.buffer.indexOf('\n\n')) !== -1) {
            const block = this.buffer.slice(0, delimiter).trim();
            this.buffer = this.buffer.slice(delimiter + 2);
            if (block.split('\n').some(line => line.startsWith('data:'))) {
                this.#appendEvent(block);
            } else {
                touchGenerationJob(this.id, this.userHandle);
            }
        }

        if (flushRemainder && this.buffer.trim()) {
            this.#appendEvent(this.buffer.trim());
            this.buffer = '';
        }
    }

    #appendEvent(block) {
        const data = block.split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n');
        this.hasDoneEvent ||= data === '[DONE]';
        if (data && data !== '[DONE]') {
            try {
                this.failed ||= Boolean(JSON.parse(data)?.error);
            } catch {
                // The existing stream parser remains responsible for malformed provider data.
            }
        }
        appendGenerationEvent(this.id, this.userHandle, block);
    }
}
