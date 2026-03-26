function cloneComparable(value) {
    if (value === undefined) {
        return '[undefined]';
    }

    if (typeof value === 'function') {
        return '[function]';
    }

    if (Array.isArray(value)) {
        return value.map(cloneComparable);
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, cloneComparable(value[key])]),
        );
    }

    return value;
}

function makeDifference(path, reason, client, server) {
    return {
        path,
        reason,
        client: cloneComparable(client),
        server: cloneComparable(server),
    };
}

function compareValues(client, server, path, differences, state) {
    if (differences.length >= state.maxDifferences) {
        state.truncated = true;
        return;
    }

    const clientIsArray = Array.isArray(client);
    const serverIsArray = Array.isArray(server);

    if (clientIsArray || serverIsArray) {
        if (!clientIsArray || !serverIsArray) {
            differences.push(makeDifference(path, 'type_mismatch', client, server));
            return;
        }

        const maxLength = Math.max(client.length, server.length);
        for (let index = 0; index < maxLength; index++) {
            if (differences.length >= state.maxDifferences) {
                state.truncated = true;
                return;
            }
            compareValues(client[index], server[index], `${path}[${index}]`, differences, state);
        }
        return;
    }

    const clientIsObject = client && typeof client === 'object';
    const serverIsObject = server && typeof server === 'object';

    if (clientIsObject || serverIsObject) {
        if (!clientIsObject || !serverIsObject) {
            differences.push(makeDifference(path, 'type_mismatch', client, server));
            return;
        }

        const keys = new Set([...Object.keys(client), ...Object.keys(server)]);
        for (const key of [...keys].sort()) {
            if (differences.length >= state.maxDifferences) {
                state.truncated = true;
                return;
            }
            compareValues(client[key], server[key], `${path}.${key}`, differences, state);
        }
        return;
    }

    if (!Object.is(client, server)) {
        differences.push(makeDifference(path, 'value_mismatch', client, server));
    }
}

export function compareChatCompletionMessages(clientChat = [], serverChat = [], { maxDifferences = 50 } = {}) {
    const differences = [];
    const state = {
        maxDifferences: Math.max(1, Number(maxDifferences) || 50),
        truncated: false,
    };

    compareValues(clientChat, serverChat, 'chat', differences, state);

    return {
        matches: differences.length === 0,
        truncated: state.truncated,
        clientLength: Array.isArray(clientChat) ? clientChat.length : 0,
        serverLength: Array.isArray(serverChat) ? serverChat.length : 0,
        differences,
    };
}
