#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { CommandLineParser } from '../src/command-line.js';
import { serverDirectory } from '../src/server-directory.js';
import { initUserStorage, getAllUserHandles, getUserDirectories } from '../src/users.js';

const STRIP_CHAT_METADATA_KEYS = ['worldInfoSummary', 'worldInfoReport'];
const STRIP_EXTRA_KEYS = ['worldInfoSummary', 'worldInfoReport'];

function stripExtra(extra) {
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
        return { value: extra, changed: false };
    }

    const next = structuredClone(extra);
    let changed = false;

    for (const key of STRIP_EXTRA_KEYS) {
        if (key in next) {
            delete next[key];
            changed = true;
        }
    }

    return { value: next, changed };
}

function stripChatMetadata(chatMetadata) {
    if (!chatMetadata || typeof chatMetadata !== 'object' || Array.isArray(chatMetadata)) {
        return { value: chatMetadata, changed: false };
    }

    const next = structuredClone(chatMetadata);
    let changed = false;

    for (const key of STRIP_CHAT_METADATA_KEYS) {
        if (key in next) {
            delete next[key];
            changed = true;
        }
    }

    return { value: next, changed };
}

function sanitizeRecord(record, isHeader) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return { value: record, changed: false };
    }

    const next = structuredClone(record);
    let changed = false;

    if (isHeader && next.chat_metadata && typeof next.chat_metadata === 'object' && !Array.isArray(next.chat_metadata)) {
        const result = stripChatMetadata(next.chat_metadata);
        next.chat_metadata = result.value;
        changed ||= result.changed;
    }

    if (next.extra && typeof next.extra === 'object' && !Array.isArray(next.extra)) {
        const result = stripExtra(next.extra);
        next.extra = result.value;
        changed ||= result.changed;
    }

    if (Array.isArray(next.swipe_info)) {
        let swipeChanged = false;
        next.swipe_info = next.swipe_info.map((swipeInfo) => {
            if (!swipeInfo || typeof swipeInfo !== 'object' || Array.isArray(swipeInfo) || !swipeInfo.extra || typeof swipeInfo.extra !== 'object' || Array.isArray(swipeInfo.extra)) {
                return swipeInfo;
            }

            const result = stripExtra(swipeInfo.extra);
            if (result.changed) {
                swipeChanged = true;
            }

            return {
                ...swipeInfo,
                extra: result.value,
            };
        });
        changed ||= swipeChanged;
    }

    return { value: next, changed };
}

function processJsonlFile(filePath) {
    const original = fs.readFileSync(filePath, 'utf8');
    if (!original.trim()) {
        return { changed: false, bytesSaved: 0 };
    }

    const lines = original.split(/\r?\n/);
    const trailingNewline = /\r?\n$/.test(original);
    let changed = false;

    const nextLines = lines.map((line, index) => {
        if (!line.trim()) {
            return line;
        }

        let parsed;
        try {
            parsed = JSON.parse(line);
        } catch {
            return line;
        }

        const result = sanitizeRecord(parsed, index === 0);
        changed ||= result.changed;
        return result.changed ? JSON.stringify(result.value) : line;
    });

    if (!changed) {
        return { changed: false, bytesSaved: 0 };
    }

    const next = nextLines.join('\n') + (trailingNewline ? '\n' : '');
    writeFileAtomicSync(filePath, next, 'utf8');
    return {
        changed: true,
        bytesSaved: Math.max(0, Buffer.byteLength(original, 'utf8') - Buffer.byteLength(next, 'utf8')),
    };
}

function collectJsonlFiles(rootPath) {
    if (!fs.existsSync(rootPath)) {
        return [];
    }

    const queue = [rootPath];
    const files = [];

    while (queue.length) {
        const current = queue.pop();
        if (!current) {
            continue;
        }

        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }

            if (entry.isFile() && path.extname(entry.name) === '.jsonl') {
                files.push(fullPath);
            }
        }
    }

    return files;
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = -1;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    return `${value.toFixed(2)} ${units[unitIndex]}`;
}

async function main() {
    process.chdir(serverDirectory);

    const cliArgs = new CommandLineParser().parse(process.argv);
    globalThis.DATA_ROOT = cliArgs.dataRoot;
    globalThis.DEFAULT_CONTENT_ROOT = cliArgs.defaultContentRoot;
    globalThis.DEFAULT_SCAFFOLD_ROOT = cliArgs.defaultScaffoldRoot;
    globalThis.COMMAND_LINE_ARGS = cliArgs;

    await initUserStorage(globalThis.DATA_ROOT);

    const handles = await getAllUserHandles();
    let totalFilesScanned = 0;
    let totalFilesChanged = 0;
    let totalBytesSaved = 0;

    for (const handle of handles) {
        const directories = getUserDirectories(handle);
        const chatFiles = [
            ...collectJsonlFiles(directories.chats),
            ...collectJsonlFiles(directories.groupChats),
        ];

        let userChanged = 0;
        let userSaved = 0;

        for (const filePath of chatFiles) {
            totalFilesScanned++;
            const result = processJsonlFile(filePath);
            if (!result.changed) {
                continue;
            }

            totalFilesChanged++;
            userChanged++;
            userSaved += result.bytesSaved;
            totalBytesSaved += result.bytesSaved;
        }

        console.log(`${handle}: scanned ${chatFiles.length} chat files, changed ${userChanged}, saved ${formatBytes(userSaved)}`);
    }

    console.log(`Done. Scanned ${totalFilesScanned} chat files, changed ${totalFilesChanged}, saved ${formatBytes(totalBytesSaved)}.`);
}

await main();
